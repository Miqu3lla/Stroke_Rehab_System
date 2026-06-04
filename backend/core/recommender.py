from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd

from core import exercise_catalog, trajectory
from core.supabase_db import fetch_patient_history, get_patient_by_id

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


# ── v2: Trajectory-aware session recommender (Patient X loop) ──────────
# The vision (Patient X scenario):
#   Phase 1 (Gather)  → fetch_patient_history pulls the full war history
#   Phase 2 (Brain)   → trajectory.analyze_trajectory classifies state
#                        and fires signals (rapid_drop, strength_gain,
#                        fatigue_pattern, sustained_high, …)
#   Phase 3 (Prescribe) → trajectory.trajectory_to_action maps state →
#                          downgrade/maintain/upgrade, then we pick
#                          exercises from the catalog and scale duration.
#
# The brain is rule-based today; the interface is shaped so a trained
# LSTM trajectory model can replace analyze_trajectory() without
# touching this function.

def _intensity_from_action(action: str) -> str:
    return {"downgrade": "low", "maintain": "moderate", "upgrade": "high"}.get(action, "moderate")


def _sessions_per_week_from_action(action: str) -> int:
    return {"downgrade": 2, "maintain": 3, "upgrade": 4}.get(action, 3)


def recommend_session_v2(
    patient_id: str,
    count: int = 3,
    history_limit: int = 50,
) -> Dict[str, Any]:
    """Build a 3-phase adaptive session recommendation.

    Returns a dict with shape:
        {
            "patient_id": "...",
            "trajectory": { state, confidence, signals, summary, per_exercise, evidence },
            "action": { action, duration_multiplier, rationale },
            "exercises": [
                { id, exercise_type, name, description, body_area,
                  duration_minutes, intensity, difficulty_level, focus,
                  affected_area, affected_side, reasoning }
            ],
            "model_source": "rule_based_trajectory",
        }
    """
    patient = get_patient_by_id(patient_id)
    if not patient:
        return {
            "patient_id": patient_id,
            "error": "patient_not_found",
            "exercises": [],
        }

    affected_area = (patient.get("affected_area") or "both").strip().lower()
    # Default to 'both' (bilateral) for older or incomplete patient rows
    # rather than silently assuming 'right' — the recommender exposes
    # this in side guidance text the patient sees, so a wrong default
    # would be visibly incorrect.
    affected_side = (patient.get("affected_side") or "both").strip().lower()
    months_in_recovery = int(patient.get("months_in_recovery") or 0)

    # Phase 1: gather
    history = fetch_patient_history(patient_id, limit=history_limit)

    # Phase 2: classify
    trajectory_result = trajectory.analyze_trajectory(history)
    state = trajectory_result["state"]
    signals = trajectory_result["signals"]

    # Phase 3: prescribe
    # Trajectory says what to do based on performance; recovery-phase
    # modifier caps that for acute patients (don't push fresh post-stroke
    # patients hard even if Day-3 scores look great) and gives chronic
    # patients a slight bonus on upgrades.
    raw_action = trajectory.trajectory_to_action(state, signals)
    action = trajectory.apply_phase_modifier(raw_action, months_in_recovery)

    catalog = exercise_catalog.load_catalog()
    picked = exercise_catalog.pick_exercises_for_action(
        catalog, affected_area, action["action"], count=count,
    )

    intensity = _intensity_from_action(action["action"])
    sessions_per_week = _sessions_per_week_from_action(action["action"])
    duration_multiplier = float(action.get("duration_multiplier") or 1.0)
    # Side guidance appended to each exercise's reasoning so the patient
    # sees a unilateral/bilateral training reminder per card.
    side_note = trajectory.side_guidance(affected_side)

    exercises: List[Dict[str, Any]] = []
    for index, ex in enumerate(picked):
        base_minutes = ex.get("base_duration_minutes") or 2
        # Floor at 1min so trajectory downgrades on a short base duration
        # (e.g. 2min * 0.8 = 1.6 → 2min) aren't clamped up to a longer
        # session than the catalog prescribes.
        duration_minutes = max(1, int(round(base_minutes * duration_multiplier)))

        # Per-exercise reasoning: pull this exercise's trajectory stats
        # if it appears in the patient's history.
        stats = trajectory_result["per_exercise"].get(ex["id"])
        if stats and stats.get("latest_score") is not None:
            latest = stats["latest_score"]
            mean = stats.get("mean_score") or latest
            per_ex_reason = (
                f"Your last {stats['exercise_name'] or 'session'} was "
                f"{round(latest)}% (avg {round(mean)}%, trend: {stats['trend']})."
            )
        else:
            per_ex_reason = "First time tracking this exercise — start at a comfortable pace."

        if side_note:
            per_ex_reason = f"{per_ex_reason} {side_note}"

        exercises.append({
            "id": ex["id"],
            "exercise_type": ex["exercise_type"],
            "name": ex["name"],
            "description": ex["description"],
            "body_area": ex["body_area"],
            "duration_minutes": duration_minutes,
            "intensity": intensity,
            "difficulty_level": ex["difficulty_level"],
            "focus": ex["focus"],
            "affected_area": affected_area,
            "affected_side": affected_side,
            "session_index": index,
            "reasoning": per_ex_reason,
            "demo_video_path": ex.get("demo_video_path"),
            "recommendation": {
                "intensity": intensity,
                "focus": ex["focus"],
                "details": {
                    "recommended_sessions_per_week": sessions_per_week,
                    "primary_focus": ex["focus"],
                },
            },
        })

    return {
        "patient_id": patient_id,
        "trajectory": trajectory_result,
        "action": action,
        "recovery_phase": action.get("phase"),
        "side_guidance": side_note,
        "exercises": exercises,
        "model_source": "rule_based_trajectory",
    }
