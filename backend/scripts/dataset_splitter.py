import argparse
import random
from pathlib import Path
from shutil import copy2


def split_dataset(source: Path, target: Path, seed: int = 42) -> None:
    # Shuffle first so the split is reproducible and not biased by folder order.
    random.seed(seed)
    files = [p for p in source.rglob("*") if p.is_file()]
    random.shuffle(files)

    train_cut = int(len(files) * 0.7)
    val_cut = int(len(files) * 0.85)

    splits = {
        "train": files[:train_cut],
        "val": files[train_cut:val_cut],
        "test": files[val_cut:],
    }

    for split_name, split_files in splits.items():
        split_dir = target / split_name
        split_dir.mkdir(parents=True, exist_ok=True)
        for file_path in split_files:
            # Copy files into each split bucket without changing the original archive.
            destination = split_dir / file_path.name
            copy2(file_path, destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Split dataset into train/val/test.")
    parser.add_argument("--source", required=True, help="Source dataset directory")
    parser.add_argument("--target", required=True, help="Target split root directory")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    split_dataset(Path(args.source), Path(args.target), seed=args.seed)
    print("Dataset split completed.")
