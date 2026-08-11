"""One-off: train per-exercise sit_to_stand LSTM (last-timestep readout,
same recipe as hand_to_mouth/shoulder_flexion). Prints held-out test metrics."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from train_model import train_lstm

DATA = Path("../../datasets/Ready_Dataset").resolve()
OUT = Path("../models/lstm_sit_to_stand.pth").resolve()


def main():
    rec = train_lstm(
        data_dir=DATA,
        output_weights=OUT,
        exercise_filter="Sit To Stand",
        epochs=25,
        batch_size=16,
        early_stopping_patience=3,
        compile_model=False,
        seed=42,
    )
    t = (rec or {}).get("test", {})
    cm = t.get("confusion_matrix", {})
    print("\n==== SIT_TO_STAND HELD-OUT TEST ====")
    print("readout:", (rec or {}).get("hyperparameters", {}).get("readout", (rec or {}).get("readout")))
    print(f"test acc: {t.get('accuracy')}  n={t.get('num_samples')}")
    print(f"TP={cm.get('true_positive')} TN={cm.get('true_negative')} FP={cm.get('false_positive')} FN={cm.get('false_negative')}")
    print(f"precision={t.get('precision')} recall={t.get('recall')} f1={t.get('f1')}")


if __name__ == "__main__":
    main()
