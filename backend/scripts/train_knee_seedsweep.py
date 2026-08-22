"""Reproduction recipe for knee_extension's live hybrid model: pooled-readout
LSTM, lower LR + ReduceLROnPlateau scheduler (gradient clipping already in the
loop). Runs several seeds, prints a per-seed consistency table, and selects the
best by VALIDATION loss (never test). The winner is written directly to
models/lstm_knee_extension.pth — the filename the runtime actually loads.
"""
import shutil
from pathlib import Path

from train_model import train_lstm

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent.parent / "datasets" / "Ready_Dataset"
SCRATCH = Path(r"C:\Users\MATTHE~1\AppData\Local\Temp\claude\c--Users-Matthew-Dee-Documents-School-work-LSPU-School-works-3rd-year-2nd-sem-CMSC-312-Development-Stroke-Rehab-System\79b714fb-4194-46a4-8cd1-f88714cd159e\scratchpad\knee_seeds")
FINAL = SCRIPT_DIR.parent / "models" / "lstm_knee_extension.pth"
SEEDS = [0, 1, 2, 3, 42]


def val_acc_at(history, best_epoch):
    for r in history:
        if r["epoch"] == best_epoch:
            return r["val_accuracy"]
    return None


def curve_extremes(history):
    tl = [r["train_loss"] for r in history]
    ta = [r["train_accuracy"] for r in history]
    return min(tl), max(ta)  # lowest train loss reached, highest train acc reached


def main():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    rows = []
    for s in SEEDS:
        out = SCRATCH / f"knee_seed{s}.pth"
        print(f"\n{'#'*66}\n# SEED {s}\n{'#'*66}")
        rec = train_lstm(
            data_dir=DATA_DIR, output_weights=out, exercise_filter="Knee Extension",
            epochs=80, batch_size=8, num_workers=0, compile_model=False,
            augment_flip=True, early_stopping_patience=15,
            learning_rate=3e-4, use_scheduler=True, seed=s,
        )
        t = (rec or {}).get("test") or {}
        cm = t.get("confusion_matrix", {})
        min_tl, max_ta = curve_extremes(rec["history"])
        rows.append({
            "seed": s, "best_epoch": rec["best_epoch"], "best_val_loss": rec["best_val_loss"],
            "val_acc": val_acc_at(rec["history"], rec["best_epoch"]),
            "test_acc": t.get("accuracy"), "tp": cm.get("true_positive"), "tn": cm.get("true_negative"),
            "fp": cm.get("false_positive"), "fn": cm.get("false_negative"),
            "min_train_loss": round(min_tl, 4), "max_train_acc": round(max_ta, 1),
            "path": out,
        })

    rows.sort(key=lambda r: r["best_val_loss"])  # SELECT BY VAL LOSS
    print(f"\n{'='*90}\nSEED SWEEP (sorted by val loss; selection is by VAL, test shown for consistency only)\n{'='*90}")
    print(f"{'seed':>4} {'bestEp':>6} {'valLoss':>8} {'valAcc':>7} {'testAcc':>8} {'TP/TN/FP/FN':>12} {'minTrLoss':>10} {'maxTrAcc':>9}")
    for r in rows:
        conf = f"{r['tp']}/{r['tn']}/{r['fp']}/{r['fn']}"
        print(f"{r['seed']:>4} {r['best_epoch']:>6} {r['best_val_loss']:>8.4f} {r['val_acc']:>6.1f}% "
              f"{r['test_acc']:>7.1f}% {conf:>12} {r['min_train_loss']:>10.4f} {r['max_train_acc']:>8.1f}%")

    winner = rows[0]
    shutil.copy2(winner["path"], FINAL)
    shutil.copy2(winner["path"].with_name(winner["path"].stem + "_metrics.json"),
                 FINAL.with_name(FINAL.stem + "_metrics.json"))
    print(f"\nWINNER by val loss: seed {winner['seed']} "
          f"(val_loss={winner['best_val_loss']:.4f}, test={winner['test_acc']:.1f}%) "
          f"-> copied to {FINAL.name}")


if __name__ == "__main__":
    main()
