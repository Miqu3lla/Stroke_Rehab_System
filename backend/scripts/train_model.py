import argparse
from contextlib import nullcontext
from pathlib import Path
import sys
from typing import Dict, Tuple

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
    normalized = path.parent.name.lower().strip()
    if normalized in LABEL_ALIASES:
        return LABEL_ALIASES[normalized]

    for alias, label in LABEL_ALIASES.items():
        if alias in normalized:
            return label

    if "correct" in path.stem.lower() or "correct" in normalized:
        return 1
    if "incorrect" in path.stem.lower() or "incorrect" in normalized:
        return 0

    return 0


def _sequence_to_tensor(sequence: Dict[str, object], target_len: int = SEQUENCE_LEN) -> torch.Tensor:
    frames = sequence.get("sequence", []) if isinstance(sequence, dict) else []
    keypoint_frames = []

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

        keypoint_frames.append(keypoints)

    if len(keypoint_frames) > target_len:
        keypoint_frames = keypoint_frames[-target_len:]
    if len(keypoint_frames) < target_len:
        pad = [[0.0] * INPUT_SIZE for _ in range(target_len - len(keypoint_frames))]
        keypoint_frames = pad + keypoint_frames

    return torch.tensor(keypoint_frames, dtype=torch.float32)


def _load_video_dataset_loader(
    data_dir: Path,
    batch_size: int,
    num_workers: int,
    pin_memory: bool,
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

    frames = []
    labels = []
    for video_path in video_files:
        try:
            sequence = extract_sequence_from_video(str(video_path), sample_every_n=2)
            tensor = _sequence_to_tensor(sequence)
            frames.append(tensor.numpy())
            labels.append(_infer_label_from_path(video_path))
        except Exception as exc:
            print(f"Skipping {video_path.name}: {exc}")

    if not frames:
        return _build_synthetic_loader(
            batch_size=batch_size,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )

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
    patience_counter = 0
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
        model.eval()
        val_loss = 0.0
        val_correct = 0
        with torch.no_grad():
            pbar_val = tqdm(val_loader, desc=f"Epoch {epoch + 1}/{epochs} [VAL]", leave=False)
            for batch_x, batch_y in pbar_val:
                batch_x = batch_x.to(device, non_blocking=device.type == "cuda")
                batch_y = batch_y.to(device, non_blocking=device.type == "cuda")
                with _autocast_context(device, runtime):
                    logits = model(batch_x)
                    loss = criterion(logits, batch_y)
                    val_correct += (logits.argmax(dim=1) == batch_y).sum().item()
                val_loss += float(loss.item())
                pbar_val.set_postfix({"loss": f"{val_loss / (pbar_val.n + 1):.4f}"})

        avg_val_loss = val_loss / max(len(val_loader), 1)
        val_acc = (val_correct / max(len(val_dataset), 1)) * 100
        model.train()

        # GPU memory info
        mem_info = _get_gpu_memory_info(device)
        mem_str = f" | GPU: {mem_info['allocated_mb']:.1f}MB allocated, {mem_info['reserved_mb']:.1f}MB reserved" if device.type == "cuda" else ""
        print(f"Epoch {epoch + 1}/{epochs} | Train Loss={avg_train_loss:.4f} | Train Acc={train_acc:.2f}% | Val Loss={avg_val_loss:.4f} | Val Acc={val_acc:.2f}%{mem_str}")

        # Checkpoint and early stopping
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
            model_to_save = model._orig_mod if hasattr(model, "_orig_mod") else model
            torch.save(model_to_save.state_dict(), output_weights)
            print(f"  ✓ Best checkpoint saved (val_loss={avg_val_loss:.4f})")
        else:
            patience_counter += 1
            print(f"  ⚠ No improvement ({patience_counter}/{early_stopping_patience})")
            if patience_counter >= early_stopping_patience:
                print(f"Early stopping triggered after {epoch + 1} epochs.")
                break

    peak_mem_gb = torch.cuda.max_memory_allocated(device) / 1024 / 1024 / 1024 if device.type == "cuda" else 0
    reserved_mem_gb = torch.cuda.memory_reserved(device) / 1024 / 1024 / 1024 if device.type == "cuda" else 0

    print(f"\n{'='*70}")
    print(f"Latest Training Result ({epoch + 1} Epochs)")
    print(f"Train Loss: {avg_train_loss:.4f} | Train Accuracy: {train_acc:.2f}%")
    print(f"Val Loss: {avg_val_loss:.4f} | Val Accuracy: {val_acc:.2f}%")
    if device.type == "cuda":
        print(f"GPU Peak Memory: {peak_mem_gb:.2f} GB | Memory Reserved: {reserved_mem_gb:.2f} GB")
    print(f"{'='*70}")
    print(f"Best model saved to: {output_weights.resolve()}")


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
    )
