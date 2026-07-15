import argparse
from contextlib import nullcontext
from datetime import datetime
import json
from pathlib import Path
import pickle
import sys
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset, random_split
from tqdm import tqdm

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.mediapipe_vision import extract_sequence_from_video

INPUT_SIZE = 99
SEQUENCE_LEN = 40
LANDMARK_COUNT = 33

# MediaPipe Pose left/right landmark pairs, used by _flip_clip.
#
# Why flip augmentation exists here: the live path (mediapipe_vision.
# estimate_pose_from_image_bytes) mirrors every frame with cv2.flip so the
# on-screen skeleton matches the phone's selfie preview, but training videos
# are NOT mirrored. MediaPipe names landmarks from what it sees, so in a
# mirrored frame a patient's real right arm is reported as the LEFT arm.
# The model would therefore learn a movement in one set of landmark slots and
# receive it in the opposite slots at inference. Training on both orientations
# removes that mismatch (and doubles the training set).
#
# A mirror is NOT just x -> -x on the same index: landmarks are labelled
# anatomically, so the left/right indices must swap too. Index 0 (nose) is
# central and unpaired.
_LR_LANDMARK_PAIRS = [
    (1, 4), (2, 5), (3, 6),        # eyes (inner / center / outer)
    (7, 8),                        # ears
    (9, 10),                       # mouth corners
    (11, 12), (13, 14), (15, 16),  # shoulder / elbow / wrist
    (17, 18), (19, 20), (21, 22),  # pinky / index / thumb
    (23, 24), (25, 26), (27, 28),  # hip / knee / ankle
    (29, 30), (31, 32),            # heel / foot index
]


def _build_flip_permutation() -> np.ndarray:
    perm = list(range(LANDMARK_COUNT))
    for a, b in _LR_LANDMARK_PAIRS:
        perm[a], perm[b] = perm[b], perm[a]
    return np.asarray(perm, dtype=np.int64)


_FLIP_PERMUTATION = _build_flip_permutation()


def _flip_clip(clip: np.ndarray) -> np.ndarray:
    """Horizontally mirror one [T, 99] hip-centered clip.

    Keypoints are hip-centered upstream (hip midpoint at the origin), so
    negating x reflects the pose about the body's own centerline. Reordering
    the landmark axis then swaps the anatomical left/right labels. y (vertical)
    and z (depth) are untouched - a left/right mirror changes neither. All-zero
    frames (failed detections) stay zero under both steps.
    """
    frames = clip.reshape(clip.shape[0], LANDMARK_COUNT, 3).copy()
    frames[..., 0] *= -1.0                 # mirror about the hip center
    frames = frames[:, _FLIP_PERMUTATION]  # swap left/right landmark labels
    return frames.reshape(clip.shape[0], INPUT_SIZE)
# Bumped from 256 to 1024 — the LSTM is tiny (~100K params) so 16GB
# VRAM has room to spare and a larger batch keeps the GPU busier
# between data loads. Override with --batch-size if you ever go OOM.
DEFAULT_BATCH_SIZE = 1024
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
LABEL_ALIASES = {
    "correct": 1,
    "incorrect": 0,
    "arm raise correct": 1,
    "arm raise incorrect": 0,
    "sit to stand correct": 1,
    "sit to stand incorrect": 0,
}


class StrokeLSTMClassifier(nn.Module):
    def __init__(self, input_size: int = INPUT_SIZE, hidden_size: int = 128, num_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Linear(64, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        outputs, _ = self.lstm(x)
        return self.head(outputs[:, -1, :])


def _build_synthetic_loader(batch_size: int, num_workers: int, pin_memory: bool) -> DataLoader:
    samples = 256
    x = torch.randn(samples, SEQUENCE_LEN, INPUT_SIZE)
    y = (x.mean(dim=(1, 2)) > 0).long()
    dataset = TensorDataset(x, y)
    return _create_loader(
        dataset,
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )


def _create_loader(
    dataset: TensorDataset,
    batch_size: int,
    num_workers: int,
    pin_memory: bool,
) -> DataLoader:
    # Pinning memory helps asynchronous CUDA transfers.
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=pin_memory,
        persistent_workers=num_workers > 0,
    )


def _infer_label_from_path(path: Path) -> int:
    """Infer a clip's label from its folder name, falling back to the filename.

    ORDER IS LOAD-BEARING: the word "incorrect" CONTAINS the substring
    "correct", so every check must test for "incorrect" first. Testing
    "correct" first silently labels every "... Incorrect" folder as correct.
    That is exactly what happened to "Knee Extension Incorrect" — it has no
    exact entry in LABEL_ALIASES, fell through to the substring scan, matched
    "correct", and trained the model that bad knee form was good form.
    """
    normalized = path.parent.name.lower().strip()
    if normalized in LABEL_ALIASES:
        return LABEL_ALIASES[normalized]

    # "incorrect" before "correct" — see the docstring. Applies to the folder
    # name first, then the filename, so a clip is still labelled correctly
    # even if the split flattened it out of its class folder.
    for candidate in (normalized, path.stem.lower()):
        if "incorrect" in candidate:
            return 0
        if "correct" in candidate:
            return 1

    return 0


# MediaPipe extraction is the slow part of a run (~20 min for this dataset),
# and it dominates every retrain even when only a hyperparameter changed. We
# cache the RAW variable-length landmark array per clip, keyed by path + mtime
# + size, so edits to resampling/augmentation stay cache-valid and only genuinely
# changed videos get re-extracted.
_POSE_CACHE_PATH = BACKEND_DIR.parent / "datasets" / "processed_data" / "pose_cache.pkl"


def _cache_key(path: Path) -> str:
    stat = path.stat()
    return f"{path.resolve()}|{int(stat.st_mtime)}|{stat.st_size}"


def _load_pose_cache() -> Dict[str, Any]:
    if not _POSE_CACHE_PATH.exists():
        return {}
    try:
        with open(_POSE_CACHE_PATH, "rb") as handle:
            return pickle.load(handle)
    except Exception:
        # A corrupt cache must never break training - just re-extract.
        return {}


def _save_pose_cache(cache: Dict[str, Any]) -> None:
    _POSE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename so an interrupted run can't leave a torn cache file.
    temp_path = _POSE_CACHE_PATH.with_suffix(".tmp")
    with open(temp_path, "wb") as handle:
        pickle.dump(cache, handle, protocol=pickle.HIGHEST_PROTOCOL)
    temp_path.replace(_POSE_CACHE_PATH)


def _raw_keypoints_array(sequence: Dict[str, object]) -> np.ndarray:
    """Flatten an extract_sequence_from_video result to [T, 99] float32."""
    frames = sequence.get("sequence", []) if isinstance(sequence, dict) else []
    rows: List[List[float]] = []
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        keypoints = frame.get("keypoints", [])
        if not isinstance(keypoints, list):
            keypoints = list(keypoints)
        if len(keypoints) < INPUT_SIZE:
            keypoints = keypoints + [0.0] * (INPUT_SIZE - len(keypoints))
        elif len(keypoints) > INPUT_SIZE:
            keypoints = keypoints[:INPUT_SIZE]
        rows.append([float(v) for v in keypoints])
    if not rows:
        return np.zeros((0, INPUT_SIZE), dtype=np.float32)
    return np.asarray(rows, dtype=np.float32)


def _resample_to_length(clip: np.ndarray, target_len: int = SEQUENCE_LEN) -> np.ndarray:
    """Force a [T, 99] clip to exactly target_len frames.

    Long clips are resampled UNIFORMLY across their full duration rather than
    truncated to the tail. Keeping only the last N frames threw away the actual
    movement on any clip longer than the window: 72% of this dataset exceeds it
    (median 4.3s vs a ~2.7s window), so a 10s sit-to-stand trained on the
    patient standing still AFTER the rep had already finished.
    """
    if clip.shape[0] == 0:
        return np.zeros((target_len, INPUT_SIZE), dtype=np.float32)
    if clip.shape[0] > target_len:
        indices = np.linspace(0, clip.shape[0] - 1, target_len).round().astype(int)
        return clip[indices]
    if clip.shape[0] < target_len:
        pad = np.zeros((target_len - clip.shape[0], INPUT_SIZE), dtype=np.float32)
        return np.concatenate([pad, clip], axis=0)
    return clip


def _load_video_dataset_loader(
    data_dir: Path,
    batch_size: int,
    num_workers: int,
    pin_memory: bool,
    augment_flip: bool = False,
) -> DataLoader:
    video_files = [
        path
        for path in sorted(data_dir.rglob("*"))
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    ]

    if not video_files:
        return _build_synthetic_loader(
            batch_size=batch_size,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )

    cache = _load_pose_cache()
    cache_hits = 0
    cache_dirty = False

    frames = []
    labels = []
    for video_path in video_files:
        try:
            key = _cache_key(video_path)
            raw = cache.get(key)
            if raw is None:
                sequence = extract_sequence_from_video(str(video_path), sample_every_n=2)
                raw = _raw_keypoints_array(sequence)
                cache[key] = raw
                cache_dirty = True
            else:
                cache_hits += 1
            frames.append(_resample_to_length(raw))
            labels.append(_infer_label_from_path(video_path))
        except Exception as exc:
            print(f"Skipping {video_path.name}: {exc}")

    if cache_dirty:
        _save_pose_cache(cache)
    print(f"  pose cache: {cache_hits}/{len(video_files)} hits ({data_dir.name})")

    if not frames:
        return _build_synthetic_loader(
            batch_size=batch_size,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )

    if augment_flip:
        # Append a mirrored copy of every clip with the SAME label: a correct
        # rep performed with the other arm is still a correct rep. Train split
        # only - augmenting val/test would inflate their scores and stop them
        # measuring generalization honestly.
        original_count = len(frames)
        frames = frames + [_flip_clip(clip) for clip in frames]
        labels = labels + list(labels)
        print(f"  flip augmentation: {original_count} -> {len(frames)} samples")

    x = torch.tensor(np.stack(frames), dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)
    return _create_loader(
        TensorDataset(x, y),
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )


def _autocast_context(device: torch.device, runtime: Dict[str, object]):
    if device.type == "cuda" and runtime["amp_dtype"] is not None:
        return torch.autocast("cuda", dtype=runtime["amp_dtype"])
    return nullcontext()


def _get_gpu_memory_info(device: torch.device) -> Dict[str, float]:
    """Return GPU memory usage in MB (or empty dict if CPU)."""
    if device.type != "cuda":
        return {"allocated_mb": 0.0, "reserved_mb": 0.0}
    
    torch.cuda.synchronize()
    allocated = torch.cuda.memory_allocated() / 1024 / 1024
    reserved = torch.cuda.memory_reserved() / 1024 / 1024
    return {"allocated_mb": allocated, "reserved_mb": reserved}


def _split_dataset(
    dataset: TensorDataset,
    val_split: float = 0.2,
    seed: int = 42,
) -> Tuple[TensorDataset, TensorDataset]:
    """Split dataset into train and validation sets."""
    generator = torch.Generator().manual_seed(seed)
    val_size = int(len(dataset) * val_split)
    train_size = len(dataset) - val_size
    train_dataset, val_dataset = random_split(dataset, [train_size, val_size], generator=generator)
    return train_dataset, val_dataset


def _configure_cuda_runtime(device: torch.device) -> Dict[str, object]:
    runtime = {
        "cuda_enabled": device.type == "cuda",
        "amp_dtype": None,
    }

    if device.type != "cuda":
        return runtime

    # Enable Tensor Core friendly kernels on fixed-shape workloads.
    torch.backends.cudnn.benchmark = True
    if hasattr(torch.backends.cuda.matmul, "allow_tf32"):
        torch.backends.cuda.matmul.allow_tf32 = True
    if hasattr(torch.backends.cudnn, "allow_tf32"):
        torch.backends.cudnn.allow_tf32 = True
    torch.set_float32_matmul_precision("high")

    runtime["amp_dtype"] = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return runtime


def _evaluate(
    model: nn.Module,
    loader: DataLoader,
    dataset: Any,
    criterion: nn.Module,
    device: torch.device,
    runtime: Dict[str, object],
    desc: str = "[VAL]",
) -> Dict[str, Any]:
    """One no-grad pass. Returns loss/accuracy plus a confusion matrix.

    Positive class = 1 = "correct form". Precision/recall are reported because
    accuracy alone hides the failure that matters clinically: a model that
    calls bad form "correct" (false positive) tells a stroke patient to keep
    doing a harmful movement.
    """
    was_training = model.training
    model.eval()
    total_loss = 0.0
    hits = 0
    tp = tn = fp = fn = 0

    with torch.no_grad():
        pbar = tqdm(loader, desc=desc, leave=False)
        for batch_x, batch_y in pbar:
            batch_x = batch_x.to(device, non_blocking=device.type == "cuda")
            batch_y = batch_y.to(device, non_blocking=device.type == "cuda")
            with _autocast_context(device, runtime):
                logits = model(batch_x)
                loss = criterion(logits, batch_y)
            preds = logits.argmax(dim=1)
            hits += (preds == batch_y).sum().item()
            tp += int(((preds == 1) & (batch_y == 1)).sum().item())
            tn += int(((preds == 0) & (batch_y == 0)).sum().item())
            fp += int(((preds == 1) & (batch_y == 0)).sum().item())
            fn += int(((preds == 0) & (batch_y == 1)).sum().item())
            total_loss += float(loss.item())
            pbar.set_postfix({"loss": f"{total_loss / (pbar.n + 1):.4f}"})

    if was_training:
        model.train()

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return {
        "loss": total_loss / max(len(loader), 1),
        "accuracy": (hits / max(len(dataset), 1)) * 100,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confusion_matrix": {
            "true_positive": tp,
            "true_negative": tn,
            "false_positive": fp,
            "false_negative": fn,
        },
        "num_samples": len(dataset),
    }


def _count_labels(dataset: Any) -> Dict[str, int]:
    """Class balance of a dataset, so the run record shows what was fed in."""
    try:
        labels = [int(dataset[i][1]) for i in range(len(dataset))]
    except Exception:
        return {}
    return {
        "correct": sum(1 for v in labels if v == 1),
        "incorrect": sum(1 for v in labels if v == 0),
    }


def _has_videos(directory: Path) -> bool:
    if not directory.exists():
        return False
    return any(
        p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
        for p in directory.rglob("*")
    )


def train_lstm(
    data_dir: Path,
    output_weights: Path,
    epochs: int = 25,
    batch_size: int = DEFAULT_BATCH_SIZE,
    # i5-10400F has 12 threads — pushing workers higher than 4 lets video
    # decoding parallelize so the GPU isn't waiting on data preprocessing.
    num_workers: int = 8,
    compile_model: bool = True,
    val_split: float = 0.2,
    early_stopping_patience: int = 3,
    augment_flip: bool = True,
) -> None:
    """
    Train a baseline LSTM classifier with validation, checkpointing, and early stopping.
    Falls back to synthetic data when no CSV sequences are available.
    """
    print(f"Training data directory: {data_dir.resolve()}")

    train_source = data_dir / "train"
    val_source = data_dir / "val"
    has_split_folders = train_source.exists() and val_source.exists()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    runtime = _configure_cuda_runtime(device)
    if device.type == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        capability = torch.cuda.get_device_capability(0)
        print(f"CUDA device: {gpu_name} | capability={capability}")
        print(f"AMP dtype: {runtime['amp_dtype']}")

    # Prefer the real Ready_Dataset split folders when they exist.
    if has_split_folders:
        train_loader = _load_video_dataset_loader(
            train_source,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
            augment_flip=augment_flip,
        )
        val_loader = _load_video_dataset_loader(
            val_source,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
        )
        train_dataset = train_loader.dataset
        val_dataset = val_loader.dataset
        print("Using Ready_Dataset train/val folders with direct MP4 loading")
        print(f"Train samples: {len(train_dataset)} | Val samples: {len(val_dataset)}")
    else:
        # Fall back to CSVs or synthetic data if the split folders are not present.
        full_dataset_loader = _load_video_dataset_loader(
            data_dir,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
        )
        full_dataset = full_dataset_loader.dataset

        # Split into train/val
        train_dataset, val_dataset = _split_dataset(full_dataset, val_split=val_split)
        train_loader = _create_loader(
            train_dataset,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
        )
        val_loader = _create_loader(
            val_dataset,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
        )
        print(f"Train samples: {len(train_dataset)} | Val samples: {len(val_dataset)}")

    model = StrokeLSTMClassifier().to(device)
    if compile_model and device.type == "cuda" and hasattr(torch, "compile"):
        try:
            model = torch.compile(model, mode="max-autotune")
            print("torch.compile enabled (max-autotune)")
        except Exception as exc:
            print(f"torch.compile skipped: {exc}")

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    use_fp16_scaler = device.type == "cuda" and runtime["amp_dtype"] == torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=use_fp16_scaler)

    best_val_loss = float("inf")
    best_epoch = 0
    patience_counter = 0
    history: list = []
    output_weights.parent.mkdir(parents=True, exist_ok=True)

    model.train()
    for epoch in range(epochs):
        # Training phase
        running_loss = 0.0
        train_correct = 0
        pbar = tqdm(train_loader, desc=f"Epoch {epoch + 1}/{epochs} [TRAIN]", leave=False)
        for batch_x, batch_y in pbar:
            batch_x = batch_x.to(device, non_blocking=device.type == "cuda")
            batch_y = batch_y.to(device, non_blocking=device.type == "cuda")

            optimizer.zero_grad(set_to_none=True)
            with _autocast_context(device, runtime):
                logits = model(batch_x)
                loss = criterion(logits, batch_y)
                train_correct += (logits.argmax(dim=1) == batch_y).sum().item()

            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()

            running_loss += float(loss.item())
            pbar.set_postfix({"loss": f"{running_loss / (pbar.n + 1):.4f}"})

        avg_train_loss = running_loss / max(len(train_loader), 1)
        train_acc = (train_correct / max(len(train_dataset), 1)) * 100

        # Validation phase
        val_metrics = _evaluate(
            model,
            val_loader,
            val_dataset,
            criterion,
            device,
            runtime,
            desc=f"Epoch {epoch + 1}/{epochs} [VAL]",
        )
        avg_val_loss = val_metrics["loss"]
        val_acc = val_metrics["accuracy"]

        # GPU memory info
        mem_info = _get_gpu_memory_info(device)
        mem_str = f" | GPU: {mem_info['allocated_mb']:.1f}MB allocated, {mem_info['reserved_mb']:.1f}MB reserved" if device.type == "cuda" else ""
        print(f"Epoch {epoch + 1}/{epochs} | Train Loss={avg_train_loss:.4f} | Train Acc={train_acc:.2f}% | Val Loss={avg_val_loss:.4f} | Val Acc={val_acc:.2f}%{mem_str}")

        history.append({
            "epoch": epoch + 1,
            "train_loss": round(avg_train_loss, 4),
            "train_accuracy": round(train_acc, 2),
            "val_loss": round(avg_val_loss, 4),
            "val_accuracy": round(val_acc, 2),
        })

        # Checkpoint and early stopping
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            best_epoch = epoch + 1
            patience_counter = 0
            model_to_save = model._orig_mod if hasattr(model, "_orig_mod") else model
            torch.save(model_to_save.state_dict(), output_weights)
            # ASCII only: Windows defaults stdout to cp1252 when it is
            # redirected to a file, and cp1252 cannot encode symbols like
            # U+2713. Unicode here crashes any logged (non-interactive) run.
            print(f"  [BEST] checkpoint saved (val_loss={avg_val_loss:.4f})")
        else:
            patience_counter += 1
            print(f"  [ ... ] no improvement ({patience_counter}/{early_stopping_patience})")
            if patience_counter >= early_stopping_patience:
                print(f"Early stopping triggered after {epoch + 1} epochs.")
                break

    peak_mem_gb = torch.cuda.max_memory_allocated(device) / 1024 / 1024 / 1024 if device.type == "cuda" else 0
    reserved_mem_gb = torch.cuda.memory_reserved(device) / 1024 / 1024 / 1024 if device.type == "cuda" else 0

    # Held-out test evaluation. Loads the BEST checkpoint rather than reusing
    # the in-memory model, which is whatever the last (possibly worse) epoch
    # produced — reporting the last epoch's test score would not match the
    # weights that actually ship.
    test_source = data_dir / "test"
    test_metrics: Optional[Dict[str, Any]] = None
    if _has_videos(test_source):
        test_loader = _load_video_dataset_loader(
            test_source,
            batch_size=batch_size,
            num_workers=num_workers if device.type == "cuda" else 0,
            pin_memory=device.type == "cuda",
        )
        best_model = StrokeLSTMClassifier().to(device)
        best_model.load_state_dict(torch.load(output_weights, map_location=device))
        test_metrics = _evaluate(
            best_model,
            test_loader,
            test_loader.dataset,
            criterion,
            device,
            runtime,
            desc="[TEST]",
        )
    else:
        print(f"\nNo test videos found at {test_source} - skipping test evaluation.")

    print(f"\n{'='*70}")
    print(f"Training Result ({epoch + 1} epochs run | best epoch: {best_epoch})")
    print(f"Train Loss: {avg_train_loss:.4f} | Train Accuracy: {train_acc:.2f}%")
    print(f"Val Loss: {avg_val_loss:.4f} | Val Accuracy: {val_acc:.2f}%")
    if test_metrics:
        cm = test_metrics["confusion_matrix"]
        print(f"{'-'*70}")
        print(f"HELD-OUT TEST (best checkpoint, n={test_metrics['num_samples']})")
        print(f"  Accuracy : {test_metrics['accuracy']:.2f}%")
        print(f"  Precision: {test_metrics['precision']:.4f}   Recall: {test_metrics['recall']:.4f}   F1: {test_metrics['f1']:.4f}")
        print(f"  Confusion: TP={cm['true_positive']} TN={cm['true_negative']} FP={cm['false_positive']} FN={cm['false_negative']}")
    if device.type == "cuda":
        print(f"{'-'*70}")
        print(f"GPU Peak Memory: {peak_mem_gb:.2f} GB | Memory Reserved: {reserved_mem_gb:.2f} GB")
    print(f"{'='*70}")

    # Persist the run so results are quotable later instead of scrolling away.
    metrics_path = output_weights.parent / "training_metrics.json"
    record: Dict[str, Any] = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "hyperparameters": {
            "epochs_requested": epochs,
            "epochs_run": epoch + 1,
            "batch_size": batch_size,
            "learning_rate": 1e-3,
            "optimizer": "Adam",
            "loss": "CrossEntropyLoss",
            "sequence_len": SEQUENCE_LEN,
            "input_size": INPUT_SIZE,
            "hidden_size": 128,
            "num_layers": 2,
            "dropout": 0.2,
            "early_stopping_patience": early_stopping_patience,
        },
        "dataset": {
            "train_samples": len(train_dataset),
            "val_samples": len(val_dataset),
            "train_class_balance": _count_labels(train_dataset),
            "val_class_balance": _count_labels(val_dataset),
        },
        "best_epoch": best_epoch,
        "best_val_loss": round(best_val_loss, 4),
        "history": history,
        "test": test_metrics,
    }
    metrics_path.write_text(json.dumps(record, indent=2))

    print(f"Best model saved to : {output_weights.resolve()}")
    print(f"Metrics saved to    : {metrics_path.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train stroke rehab LSTM model.")
    parser.add_argument(
        "--data-dir",
        default="../../datasets/Ready_Dataset",
        help="Path to the dataset root directory",
    )
    parser.add_argument(
        "--out",
        default="../models/lstm_weights.pth",
        help="Output model checkpoint path",
    )
    parser.add_argument("--epochs", type=int, default=25, help="Training epochs (default 25, with early stopping at patience limit)")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Batch size (increase on large-VRAM GPUs)",
    )
    parser.add_argument(
        "--num-workers",
        type=int,
        default=8,
        help="DataLoader worker processes (default 8 — fine for 6c/12t CPUs like the i5-10400F)",
    )
    parser.add_argument(
        "--no-compile",
        action="store_true",
        help="Disable torch.compile even when CUDA is available",
    )
    parser.add_argument(
        "--val-split",
        type=float,
        default=0.2,
        help="Validation split ratio (0.0-1.0)",
    )
    parser.add_argument(
        "--early-stop-patience",
        type=int,
        default=3,
        help="Early stopping patience (epochs with no improvement before stopping)",
    )
    parser.add_argument(
        "--no-flip-augment",
        action="store_true",
        help=(
            "Disable horizontal-flip augmentation of the train split. Flipping is "
            "on by default: the live app mirrors its frames but training videos "
            "are not mirrored, so training on both orientations is what keeps "
            "inference consistent with training (and doubles the train set)."
        ),
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    data_dir = (script_dir / args.data_dir).resolve() if not Path(args.data_dir).is_absolute() else Path(args.data_dir)
    out_path = (script_dir / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)

    train_lstm(
        data_dir,
        out_path,
        epochs=args.epochs,
        batch_size=args.batch_size,
        num_workers=args.num_workers,
        compile_model=not args.no_compile,
        val_split=args.val_split,
        early_stopping_patience=args.early_stop_patience,
        augment_flip=not args.no_flip_augment,
    )
