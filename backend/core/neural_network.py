import logging
import math
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

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
    def __init__(self, input_size: int = KEYPOINT_DIM, hidden_size: int = 128, num_layers: int = 2,
                 readout: str = "last"):
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
        # "last" = final-timestep readout (default, must match training). "maxpool"
        # = max over timesteps; opt-in per model, MUST match how the checkpoint was
        # trained. Adds no params, so a wrong choice loads fine but scores wrong.
        self.readout = readout

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        outputs, _ = self.lstm(x)
        pooled = outputs.max(dim=1).values if self.readout == "maxpool" else outputs[:, -1, :]
        return self.head(pooled)


# Slugs whose per-exercise model was trained with the max-pool readout and so
# MUST be reconstructed the same way at inference. knee_extension only — its
# correct/incorrect signal is a transient mid-clip peak the last timestep misses.
POOLED_READOUT_SLUGS = frozenset({"knee_extension"})

# Supported exercises that intentionally serve the global fallback model (no
# per-exercise checkpoint expected). Every OTHER supported exercise must ship
# its own lstm_<slug>.pth — falling back there is a silent misclassification.
# Empty as of 2026-08-11: sit_to_stand got its own trained model, so all four
# supported exercises now require a per-exercise checkpoint.
_GLOBAL_FALLBACK_OK: frozenset = frozenset()


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


# --- Geometric veto for knee_extension (hybrid with the pooled LSTM) ---
# A seated knee extension is only "correct" if the leg reaches near-full
# extension. The pooled LSTM, on its own, confidently mis-scored one incorrect
# rep whose knee never straightened (P(correct)=0.999). Inference carries no
# landmark visibility, so a single noisy frame can spike the raw peak angle
# (that clip: 124deg true peak -> 161deg raw), which defeats a plain peak<X test.
# So the veto requires the extension to be SUSTAINED: several frames at/above the
# angle. In the held-out set every correct rep holds >=11 frames >=165deg while
# every incorrect rep has zero, so this separates cleanly and a lone spike can't.
_KNEE_EXTENSION_ANGLE = 165.0    # near-full knee extension (hip-knee-ankle)
_KNEE_MIN_EXTENDED_FRAMES = 3    # sustained, not a one-frame spike
_KNEE_LEGS = {"L": (23, 25, 27), "R": (24, 26, 28)}  # (hip, knee, ankle) indices


def _knee_angle_xy(kp: List[float], hip: int, knee: int, ank: int) -> Optional[float]:
    """Interior knee angle (hip-knee-ankle) from a flat [x,y,z]*33 frame, x/y only."""
    hx, hy = kp[hip * 3], kp[hip * 3 + 1]
    kx, ky = kp[knee * 3], kp[knee * 3 + 1]
    ax, ay = kp[ank * 3], kp[ank * 3 + 1]
    v1 = (hx - kx, hy - ky)
    v2 = (ax - kx, ay - ky)
    m1 = math.hypot(*v1)
    m2 = math.hypot(*v2)
    if m1 == 0 or m2 == 0:
        return None
    return math.degrees(math.acos(max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)))))


def _knee_reaches_extension(sequence: Sequence[Any]) -> bool:
    """True if the exercised leg SUSTAINS near-full knee extension. Tracks,
    per leg, the longest run of CONSECUTIVE frames at/above the extension
    angle (not a total count — separated spikes must not accumulate) and
    takes the more-extended leg (seated knee extension is unilateral).
    Robust to single-frame noise spikes below threshold breaking the streak,
    since a real hold clears the frame minimum well past any one drop."""
    streaks = {"L": 0, "R": 0}
    longest = {"L": 0, "R": 0}
    for frame in sequence:
        kp = _extract_keypoints(frame)
        if not any(kp):  # skip empty/padded (no-pose) frames, don't break the streak
            continue
        for side, (hip, knee, ank) in _KNEE_LEGS.items():
            angle = _knee_angle_xy(kp, hip, knee, ank)
            if angle is not None and angle >= _KNEE_EXTENSION_ANGLE:
                streaks[side] += 1
                longest[side] = max(longest[side], streaks[side])
            else:
                streaks[side] = 0
    return max(longest.values()) >= _KNEE_MIN_EXTENDED_FRAMES


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


def _load_checkpoint(path: Path, readout: str = "last") -> Any:
    """Load a per-exercise or global model from `path`, or None if it can't
    be loaded cleanly. strict=True on purpose: a key mismatch means the
    saved architecture drifted from this one, and silently partial-loading
    (the old strict=False) would run inference on random weights. `readout`
    must match how the checkpoint was trained (see POOLED_READOUT_SLUGS)."""
    if not (path.exists() and path.stat().st_size > 0):
        return None
    device = _get_device()
    try:
        model = StrokeLSTMClassifier(readout=readout)
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

    readout = "maxpool" if slug in POOLED_READOUT_SLUGS else "last"
    model = _load_checkpoint(MODELS_DIR / f"lstm_{slug}.pth", readout=readout)
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
        # Import lazily to avoid any import cycle at module load.
        from core.exercise_catalog import LSTM_SUPPORTED_EXERCISE_TYPES

        dummy = [{"keypoints": [0.0] * KEYPOINT_DIM} for _ in range(DEFAULT_SEQUENCE_LEN)]
        # Warm ONLY the exercises live requests will actually route to the LSTM.
        # Callers gate on is_lstm_supported(), so warming every lstm_*.pth on
        # disk would load weights no request ever uses — dropped/gated
        # exercises (e.g. a leftover lstm_knee_extension.pth) or stale
        # checkpoints. A supported exercise with no per-exercise file warms the
        # global fallback path via classify_form_sequence, so that stays covered.
        slugs = sorted(LSTM_SUPPORTED_EXERCISE_TYPES)

        # Fail LOUDLY (in logs) when a required per-exercise checkpoint is absent:
        # its .pth is gitignored-except in .gitignore and must be deployed, but a
        # fresh/other machine could still miss it and would then silently serve the
        # global model. _GLOBAL_FALLBACK_OK is currently empty — every supported
        # exercise (including sit_to_stand) requires its own checkpoint.
        for slug in slugs:
            if slug in _GLOBAL_FALLBACK_OK:
                continue
            path = MODELS_DIR / f"lstm_{slug}.pth"
            if not (path.exists() and path.stat().st_size > 0):
                logger.warning(
                    "Required per-exercise model MISSING: %s - '%s' will fall back "
                    "to the global model and MISCLASSIFY. Place the checkpoint in %s.",
                    path.name, slug, MODELS_DIR)

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
    conf = round(float(confidence.item()), 4)
    model_source = cache["source"]

    # Hybrid geometric veto (knee_extension only): a rep that never sustains
    # near-full extension is incorrect no matter how confident the LSTM is —
    # max-pool can fire "correct" on a partial extension. Only ever downgrades
    # correct->incorrect, never the reverse.
    geometric_veto = False
    if _slug(exercise_type) in POOLED_READOUT_SLUGS and label == "correct" \
            and not _knee_reaches_extension(sequence):
        label = "incorrect"
        conf = 0.9  # rule-based override; the geometric evidence, not the LSTM prob
        model_source = f"{model_source}+geo_veto"
        geometric_veto = True

    return {
        "label": label,
        "confidence": conf,
        "frame_count": len(sequence),
        "exercise_type": exercise_type,
        "device": str(device),
        "model_source": model_source,
        "geometric_veto": geometric_veto,
    }
