import argparse
from contextlib import nullcontext
from pathlib import Path
from typing import Dict

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

INPUT_SIZE = 99
SEQUENCE_LEN = 40
DEFAULT_BATCH_SIZE = 256


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


def _load_dataset_loader(
    data_dir: Path,
    batch_size: int,
    num_workers: int,
    pin_memory: bool,
) -> DataLoader:
    csv_files = sorted(data_dir.rglob("*.csv"))
    if not csv_files:
        return _build_synthetic_loader(
            batch_size=batch_size,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )

    frames = []
    labels = []
    for csv_path in csv_files:
        df = pd.read_csv(csv_path)
        numeric = df.select_dtypes(include=[np.number]).fillna(0.0)
        if numeric.empty:
            continue

        arr = numeric.to_numpy(dtype=np.float32)
        if arr.shape[1] < INPUT_SIZE:
            arr = np.pad(arr, ((0, 0), (0, INPUT_SIZE - arr.shape[1])), mode="constant")
        elif arr.shape[1] > INPUT_SIZE:
            arr = arr[:, :INPUT_SIZE]

        if arr.shape[0] < SEQUENCE_LEN:
            pad = np.zeros((SEQUENCE_LEN - arr.shape[0], INPUT_SIZE), dtype=np.float32)
            arr = np.vstack([pad, arr])
        elif arr.shape[0] > SEQUENCE_LEN:
            arr = arr[-SEQUENCE_LEN:, :]

        frames.append(arr)
        # TODO: Replace filename-derived labels with annotation file parsing.
        label = 1 if "correct" in csv_path.stem.lower() else 0
        labels.append(label)

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
    epochs: int = 5,
    batch_size: int = DEFAULT_BATCH_SIZE,
    num_workers: int = 4,
    compile_model: bool = True,
) -> None:
    """
    Train a baseline LSTM classifier and save its state_dict.
    Falls back to synthetic data when no CSV sequences are available.
    """
    print(f"Training data directory: {data_dir.resolve()}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    runtime = _configure_cuda_runtime(device)
    if device.type == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        capability = torch.cuda.get_device_capability(0)
        print(f"CUDA device: {gpu_name} | capability={capability}")
        print(f"AMP dtype: {runtime['amp_dtype']}")

    loader = _load_dataset_loader(
        data_dir,
        batch_size=batch_size,
        num_workers=num_workers if device.type == "cuda" else 0,
        pin_memory=device.type == "cuda",
    )
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

    model.train()
    for epoch in range(epochs):
        running_loss = 0.0
        for batch_x, batch_y in loader:
            batch_x = batch_x.to(device, non_blocking=device.type == "cuda")
            batch_y = batch_y.to(device, non_blocking=device.type == "cuda")

            optimizer.zero_grad(set_to_none=True)
            with _autocast_context(device, runtime):
                logits = model(batch_x)
                loss = criterion(logits, batch_y)

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

        avg_loss = running_loss / max(len(loader), 1)
        print(f"Epoch {epoch + 1}/{epochs} | loss={avg_loss:.4f}")

    output_weights.parent.mkdir(parents=True, exist_ok=True)
    model_to_save = model._orig_mod if hasattr(model, "_orig_mod") else model
    torch.save(model_to_save.state_dict(), output_weights)
    print(f"Saved LSTM weights to: {output_weights.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train stroke rehab LSTM model.")
    parser.add_argument(
        "--data-dir",
        default="../../datasets/processed_data",
        help="Path to processed data directory",
    )
    parser.add_argument(
        "--out",
        default="../models/lstm_weights.pth",
        help="Output model checkpoint path",
    )
    parser.add_argument("--epochs", type=int, default=5, help="Training epochs")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Batch size (increase on large-VRAM GPUs)",
    )
    parser.add_argument(
        "--num-workers",
        type=int,
        default=4,
        help="DataLoader worker processes",
    )
    parser.add_argument(
        "--no-compile",
        action="store_true",
        help="Disable torch.compile even when CUDA is available",
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
    )
