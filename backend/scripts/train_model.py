import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

INPUT_SIZE = 99
SEQUENCE_LEN = 40


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


def _build_synthetic_loader(batch_size: int = 16) -> DataLoader:
    samples = 256
    x = torch.randn(samples, SEQUENCE_LEN, INPUT_SIZE)
    y = (x.mean(dim=(1, 2)) > 0).long()
    dataset = TensorDataset(x, y)
    return DataLoader(dataset, batch_size=batch_size, shuffle=True)


def _load_dataset_loader(data_dir: Path, batch_size: int = 16) -> DataLoader:
    csv_files = sorted(data_dir.rglob("*.csv"))
    if not csv_files:
        return _build_synthetic_loader(batch_size=batch_size)

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
        return _build_synthetic_loader(batch_size=batch_size)

    x = torch.tensor(np.stack(frames), dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)
    return DataLoader(TensorDataset(x, y), batch_size=batch_size, shuffle=True)


def train_lstm(data_dir: Path, output_weights: Path, epochs: int = 5) -> None:
    """
    Train a baseline LSTM classifier and save its state_dict.
    Falls back to synthetic data when no CSV sequences are available.
    """
    print(f"Training data directory: {data_dir.resolve()}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    loader = _load_dataset_loader(data_dir)
    model = StrokeLSTMClassifier().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

    model.train()
    for epoch in range(epochs):
        running_loss = 0.0
        for batch_x, batch_y in loader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)

            optimizer.zero_grad()
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            loss.backward()
            optimizer.step()

            running_loss += float(loss.item())

        avg_loss = running_loss / max(len(loader), 1)
        print(f"Epoch {epoch + 1}/{epochs} | loss={avg_loss:.4f}")

    output_weights.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), output_weights)
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
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    data_dir = (script_dir / args.data_dir).resolve() if not Path(args.data_dir).is_absolute() else Path(args.data_dir)
    out_path = (script_dir / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)

    train_lstm(data_dir, out_path, epochs=args.epochs)
