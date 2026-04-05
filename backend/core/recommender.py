from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import pandas as pd

DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "rf_recommender.pkl"
_MODEL_CACHE: Dict[str, Any] = {"model": None, "loaded": False, "source": "rule_based"}


def _encode_stroke_type(stroke_type: str) -> int:
    mapping = {
        "ischemic": 0,
        "hemorrhagic": 1,
        "tia": 2,
        "unknown": 3,
    }
    return mapping.get(stroke_type.strip().lower(), 3)


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


def _build_features(stroke_type: str, months_in_recovery: int, latest_form_score: float) -> pd.DataFrame:
    score = max(0.0, min(1.0, latest_form_score))
    return pd.DataFrame(
        [
            {
                "stroke_type_encoded": _encode_stroke_type(stroke_type),
                "months_in_recovery": int(months_in_recovery),
                "latest_form_score": float(score),
                "recovery_progress": float(score * max(1, months_in_recovery)),
            }
        ]
    )


def _rule_based_intensity(months_in_recovery: int, latest_form_score: float) -> str:
    if months_in_recovery < 3 or latest_form_score < 0.5:
        return "low"
    if latest_form_score > 0.85 and months_in_recovery >= 6:
        return "high"
    return "moderate"


def _focus_area(stroke_type: str, intensity: str) -> str:
    stroke = stroke_type.strip().lower()
    if stroke == "hemorrhagic":
        return "balance + controlled mobility"
    if intensity == "high":
        return "strength + endurance"
    if intensity == "low":
        return "mobility + form correction"
    return "functional movement + posture"


def recommend_next_plan(
    stroke_type: str,
    months_in_recovery: int,
    latest_form_score: float,
) -> Dict[str, Any]:
    cache = _load_rf_model()
    features = _build_features(stroke_type, months_in_recovery, latest_form_score)

    confidence = 0.6
    intensity = _rule_based_intensity(months_in_recovery, latest_form_score)

    if cache["model"] is not None:
        try:
            prediction = cache["model"].predict(features)[0]
            intensity = str(prediction)

            if hasattr(cache["model"], "predict_proba"):
                proba = cache["model"].predict_proba(features)
                confidence = float(max(proba[0]))
        except Exception:
            intensity = _rule_based_intensity(months_in_recovery, latest_form_score)

    intensity = intensity.lower().strip()
    if intensity not in {"low", "moderate", "high"}:
        intensity = _rule_based_intensity(months_in_recovery, latest_form_score)

    return {
        "stroke_type": stroke_type,
        "intensity": intensity,
        "focus": _focus_area(stroke_type, intensity),
        "confidence": round(confidence, 4),
        "model_source": cache["source"],
    }
