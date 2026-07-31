import logging
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

import torch
from torch import nn

from core.mediapipe_vision import _normalize_keypoints_to_hip_center

logger = logging.getLogger("uvicorn.error")

KEYPOINT_DIM = 99
MIN_SEQUENCE_FRAMES = 20
DEFAULT_SEQUENCE_LEN = 40
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
# Global fallback checkpoint, used only when no per-exercise model exists.
DEFAULT_MODEL_PATH = MODELS_DIR / "lstm_weights.pth"


class StrokeLSTMClassifier(nn.Module):
    # ARCHITECTURE MUST MATCH scripts/train_model.py::StrokeLSTMClassifier
    # EXACTLY, including the head layer ordering. It previously carried an
    # extra nn.Dropout in the head that training did not, which shifted the
    # final Linear from head.2 to head.3 — so load_state_dict(strict=False)
    # silently dropped the trained output layer and ran inference on a
    # randomly-initialized classifier. Keep the two definitions identical.
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
            nn.Linear(64, 2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        outputs, _ = self.lstm(x)
        last_hidden = outputs[:, -1, :]
        return self.head(last_hidden)


# One entry per exercise_type slug (plus "__global__" for the fallback
# checkpoint). Each value: {"model": nn.Module|None, "source": str,
# "has_weights": bool}. Populated lazily by _load_model_for().
_MODEL_CACHE: Dict[str, Dict[str, Any]] = {}


def _slug(exercise_type: str) -> str:
    """Normalize an exercise_type to its model-file slug, e.g.
    'Shoulder Flexion' / 'shoulder_flexion' -> 'shoulder_flexion'."""
    return "_".join((exercise_type or "").strip().lower().split())


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
    """Fix a live pose sequence to exactly target_len frames.

    MUST mirror scripts/train_model.py::_resample_to_length. Long sequences are
    resampled UNIFORMLY across their full span rather than truncated to the
    tail: the model is trained on whole movements, so feeding it only the last
    ~2.7 seconds at inference would show it the patient resting after the rep
    instead of the rep itself. Changing one side without the other silently
    degrades live accuracy, so keep these two in sync.
    """
    keypoint_frames = [_extract_keypoints(frame) for frame in sequence]

    if len(keypoint_frames) > target_len:
        step = (len(keypoint_frames) - 1) / (target_len - 1) if target_len > 1 else 0
        keypoint_frames = [keypoint_frames[round(i * step)] for i in range(target_len)]
    elif len(keypoint_frames) < target_len:
        pad = [[0.0] * KEYPOINT_DIM for _ in range(target_len - len(keypoint_frames))]
        keypoint_frames = pad + keypoint_frames

    tensor = torch.tensor(keypoint_frames, dtype=torch.float32).unsqueeze(0)
    return tensor


def _load_checkpoint(path: Path) -> Any:
    """Load a per-exercise or global model from `path`, or None if it can't
    be loaded cleanly. strict=True on purpose: a key mismatch means the
    saved architecture drifted from this one, and silently partial-loading
    (the old strict=False) would run inference on random weights."""
    if not (path.exists() and path.stat().st_size > 0):
        return None
    device = _get_device()
    try:
        model = StrokeLSTMClassifier()
        state = torch.load(path, map_location=device)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        model.load_state_dict(state, strict=True)
        model.to(device)
        model.eval()
        return model
    except Exception as exc:
        logger.warning("Failed to load LSTM checkpoint %s: %s", path.name, exc)
        return None


def _load_model_for(exercise_type: str) -> Dict[str, Any]:
    """Return the cached {model, source, has_weights} for an exercise_type,
    loading it on first use.

    Resolution order: the exercise's own per-exercise model
    (models/lstm_<slug>.pth) → the global fallback (models/lstm_weights.pth)
    → no model (has_weights=False, caller returns a rule-based verdict
    rather than trusting an untrained net).

    torch.compile is deliberately NOT used: these models are tiny so eager
    inference is sub-millisecond, while compile pays a multi-second
    first-request cost that overran the mobile client's timeout.
    """
    slug = _slug(exercise_type)
    if slug in _MODEL_CACHE:
        return _MODEL_CACHE[slug]

    _configure_cuda_runtime()

    model = _load_checkpoint(MODELS_DIR / f"lstm_{slug}.pth")
    if model is not None:
        entry = {"model": model, "source": f"lstm_{slug}", "has_weights": True}
        _MODEL_CACHE[slug] = entry
        return entry

    # Fall back to the shared global checkpoint (cached under a shared key so
    # every exercise without its own model reuses the one instance).
    if "__global__" not in _MODEL_CACHE:
        global_model = _load_checkpoint(DEFAULT_MODEL_PATH)
        _MODEL_CACHE["__global__"] = (
            {"model": global_model, "source": "lstm_weights_global", "has_weights": True}
            if global_model is not None
            else {"model": StrokeLSTMClassifier().to(_get_device()).eval(),
                  "source": "rule_based", "has_weights": False}
        )
    entry = _MODEL_CACHE["__global__"]
    _MODEL_CACHE[slug] = entry
    return entry


def warmup_model() -> None:
    """Load every per-exercise model and run one throwaway inference each so
    the first real request doesn't pay model-load + CUDA-init latency. Safe
    to call at startup in a background thread; any failure is swallowed
    (inference falls back to the rule-based path exactly as before)."""
    try:
        dummy = [{"keypoints": [0.0] * KEYPOINT_DIM} for _ in range(DEFAULT_SEQUENCE_LEN)]
        slugs = sorted(
            p.stem[len("lstm_"):]
            for p in MODELS_DIR.glob("lstm_*.pth")
            if p.stem != "lstm_weights"
        )
        # Warm each per-exercise model; "warmup" alone warms the global path.
        for slug in (slugs or ["warmup"]):
            classify_form_sequence(slug, dummy)
    except Exception as exc:
        # Non-fatal: inference falls back to the rule-based path, but log the
        # cause (missing weights, CUDA OOM, corrupted file) so a silently
        # degraded classifier is diagnosable instead of invisible.
        logger.warning("LSTM warmup failed; classification will use rule-based fallback: %s", exc)


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

    # CRITICAL: Normalize keypoints to hip center to match training data distribution.
    # This ensures inference data matches the normalized pose data the model was trained on.
    # Without this, live data from the mobile app will cause the model to fail.
    sequence = _normalize_keypoints_to_hip_center(sequence)

    if len(sequence) < MIN_SEQUENCE_FRAMES:
        return {
            "label": "incorrect",
            "confidence": 0.55,
            "frame_count": len(sequence),
            "exercise_type": exercise_type,
            "device": str(_get_device()),
            "model_source": "rule_based",
        }

    cache = _load_model_for(exercise_type)
    # No trained weights for this exercise (and no global fallback): don't
    # trust an untrained net — return a rule-based verdict instead.
    if not cache.get("has_weights"):
        return {
            "label": "incorrect",
            "confidence": 0.55,
            "frame_count": len(sequence),
            "exercise_type": exercise_type,
            "device": str(_get_device()),
            "model_source": "rule_based",
        }
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
