from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import pandas as pd

DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "rf_recommender.pkl"
_MODEL_CACHE: Dict[str, Any] = {"model": None, "loaded": False, "source": "rule_based"}


# Normalize the stroke type so the recommender can map it to numeric features.
# All strokes are ischemic, so always return 0.
def _encode_stroke_type(stroke_type: str) -> int:
    return 0


def _encode_area(area: str) -> int:
    mapping = {"arms": 0, "legs": 1, "both": 2, "unknown": 3}
    return mapping.get(area.strip().lower(), 3)


def _encode_side(side: str) -> int:
    mapping = {"left": 0, "right": 1, "both": 2, "unknown": 3}
    return mapping.get(side.strip().lower(), 3)


def _load_rf_model(model_path: Path = DEFAULT_MODEL_PATH) -> Dict[str, Any]:
    if _MODEL_CACHE["loaded"]:
        return _MODEL_CACHE

    model: Optional[Any] = None
    source = "rule_based"
    if model_path.exists() and model_path.stat().st_size > 0:
        try:
            model = joblib.load(model_path)
            source = "rf_model"
        except Exception:
            model = None
            source = "rule_based"

    _MODEL_CACHE.update({"model": model, "loaded": True, "source": source})
    return _MODEL_CACHE


def _build_features(
    stroke_type: str,
    months_in_recovery: int,
    latest_form_score: float,
    affected_area: str = "both",
    affected_side: str = "both",
) -> pd.DataFrame:
    # Keep the feature row explicit so model input stays easy to inspect.
    score = max(0.0, min(1.0, latest_form_score))
    return pd.DataFrame(
        [
            {
                "stroke_type_encoded": _encode_stroke_type(stroke_type),
                "months_in_recovery": int(months_in_recovery),
                "latest_form_score": float(score),
                "recovery_progress": float(score * max(1, months_in_recovery)),
                "affected_area": _encode_area(affected_area),
                "affected_side": _encode_side(affected_side),
            }
        ]
    )


def _rule_based_intensity(
    months_in_recovery: int, latest_form_score: float, affected_area: str = "both"
) -> str:
    # Fallback logic keeps the app useful even when the RF model file is missing.
    if months_in_recovery < 3 or latest_form_score < 0.5:
        return "low"

    if affected_area.strip().lower() == "legs" and months_in_recovery < 6:
        return "moderate"

    if latest_form_score > 0.85 and months_in_recovery >= 6:
        return "high"
    return "moderate"


def _focus_area(
    stroke_type: str, intensity: str, affected_area: str = "both", affected_side: str = "both"
) -> str:
    area = affected_area.strip().lower()

    if intensity == "high":
        base = "strength + endurance"
    elif intensity == "low":
        base = "mobility + form correction"
    else:
        base = "functional movement + posture"

    if area == "arms":
        return f"upper-limb focus: {base} + fine motor control"
    if area == "legs":
        return f"lower-limb focus: {base} + gait & balance training"
    return f"full-body focus: {base}"


def recommend_next_plan(
    stroke_type: str,
    months_in_recovery: int,
    latest_form_score: float,
    affected_area: str = "both",
    affected_side: str = "both",
) -> Dict[str, Any]:
    # Use the saved RF model when present, otherwise fall back to deterministic rules.
    cache = _load_rf_model()
    features = _build_features(
        stroke_type, months_in_recovery, latest_form_score, affected_area, affected_side
    )

    confidence = 0.6
    intensity = _rule_based_intensity(months_in_recovery, latest_form_score, affected_area)

    if cache["model"] is not None:
        try:
            prediction = cache["model"].predict(features)[0]
            intensity = str(prediction)

            if hasattr(cache["model"], "predict_proba"):
                proba = cache["model"].predict_proba(features)
                confidence = float(max(proba[0]))
        except Exception:
            intensity = _rule_based_intensity(months_in_recovery, latest_form_score, affected_area)

    intensity = intensity.lower().strip()
    if intensity not in {"low", "moderate", "high"}:
        intensity = _rule_based_intensity(months_in_recovery, latest_form_score, affected_area)

    focus = _focus_area(stroke_type, intensity, affected_area, affected_side)

    details = {
        "recommended_sessions_per_week": 3 if intensity == "moderate" else 2 if intensity == "low" else 4,
        "primary_focus": focus,
        "notes": [],
    }

    if affected_side.strip().lower() in {"left", "right"}:
        details["notes"].append("Include unilateral training and emphasize weaker side")

    return {
        "stroke_type": stroke_type,
        "intensity": intensity,
        "focus": focus,
        "confidence": round(confidence, 4),
        "model_source": cache["source"],
        "details": details,
    }
