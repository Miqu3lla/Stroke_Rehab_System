from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

import torch
from torch import nn

KEYPOINT_DIM = 99
MIN_SEQUENCE_FRAMES = 20
DEFAULT_SEQUENCE_LEN = 40
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "lstm_weights.pth"


class StrokeLSTMClassifier(nn.Module):
    def __init__(self, input_size: int = KEYPOINT_DIM, hidden_size: int = 128, num_layers: int = 2):
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
            nn.Dropout(0.2),
            nn.Linear(64, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        outputs, _ = self.lstm(x)
        last_hidden = outputs[:, -1, :]
        return self.head(last_hidden)


_MODEL_CACHE: Dict[str, Any] = {
    "model": None,
    "loaded": False,
    "source": "rule_based",
    "compiled": False,
}


def _get_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _configure_cuda_runtime() -> None:
    if not torch.cuda.is_available():
        return

    # Fixed-size sequence inference benefits from cuDNN autotuning and TF32 kernels.
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.set_float32_matmul_precision("high")


def _autocast_context(device: torch.device):
    if device.type != "cuda":
        return nullcontext()
    amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return torch.autocast(device_type="cuda", dtype=amp_dtype)


def _extract_keypoints(frame: Any) -> List[float]:
    if hasattr(frame, "keypoints"):
        values = getattr(frame, "keypoints")
    elif isinstance(frame, dict):
        values = frame.get("keypoints", [])
    else:
        values = []

    if not isinstance(values, list):
        values = list(values)

    if len(values) < KEYPOINT_DIM:
        values = values + [0.0] * (KEYPOINT_DIM - len(values))
    elif len(values) > KEYPOINT_DIM:
        values = values[:KEYPOINT_DIM]

    return [float(v) for v in values]


def _prepare_input_tensor(sequence: Sequence[Any], target_len: int = DEFAULT_SEQUENCE_LEN) -> torch.Tensor:
    keypoint_frames = [_extract_keypoints(frame) for frame in sequence]
    if len(keypoint_frames) > target_len:
        keypoint_frames = keypoint_frames[-target_len:]
    if len(keypoint_frames) < target_len:
        pad = [[0.0] * KEYPOINT_DIM for _ in range(target_len - len(keypoint_frames))]
        keypoint_frames = pad + keypoint_frames

    tensor = torch.tensor(keypoint_frames, dtype=torch.float32).unsqueeze(0)
    return tensor


def _load_model(model_path: Path = DEFAULT_MODEL_PATH) -> Dict[str, Any]:
    if _MODEL_CACHE["loaded"]:
        return _MODEL_CACHE

    model = StrokeLSTMClassifier()
    device = _get_device()
    _configure_cuda_runtime()
    source = "rule_based"

    if model_path.exists() and model_path.stat().st_size > 0:
        try:
            state = torch.load(model_path, map_location=device)
            if isinstance(state, dict) and "state_dict" in state:
                state = state["state_dict"]
            model.load_state_dict(state, strict=False)
            source = "lstm_weights"
        except Exception:
            source = "rule_based"

    model.to(device)
    model.eval()

    compiled = False
    if device.type == "cuda" and hasattr(torch, "compile"):
        try:
            model = torch.compile(model, mode="reduce-overhead")
            compiled = True
        except Exception:
            compiled = False

    _MODEL_CACHE.update({"model": model, "loaded": True, "source": source, "compiled": compiled})
    return _MODEL_CACHE


def classify_form_sequence(exercise_type: str, sequence: Iterable[Any]) -> Dict[str, Any]:
    sequence = list(sequence)
    if not sequence:
        return {
            "label": "insufficient_data",
            "confidence": 0.0,
            "frame_count": 0,
            "exercise_type": exercise_type,
            "device": str(_get_device()),
            "model_source": "none",
        }

    if len(sequence) < MIN_SEQUENCE_FRAMES:
        return {
            "label": "incorrect",
            "confidence": 0.55,
            "frame_count": len(sequence),
            "exercise_type": exercise_type,
            "device": str(_get_device()),
            "model_source": "rule_based",
        }

    cache = _load_model()
    model = cache["model"]
    device = _get_device()
    input_tensor = _prepare_input_tensor(sequence).to(device, non_blocking=device.type == "cuda")

    with torch.inference_mode():
        with _autocast_context(device):
            logits = model(input_tensor)
            probabilities = torch.softmax(logits, dim=-1).squeeze(0)
            confidence, predicted_idx = torch.max(probabilities, dim=0)

    label = "correct" if int(predicted_idx.item()) == 1 else "incorrect"
    return {
        "label": label,
        "confidence": round(float(confidence.item()), 4),
        "frame_count": len(sequence),
        "exercise_type": exercise_type,
        "device": str(device),
        "model_source": cache["source"],
    }
