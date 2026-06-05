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


# ── Sets-and-modes feature constants (Phase A, 2026-06-04) ─────────────
# 3 sets × 12 reps is the rep baseline both modes share. The hold
# finisher is appended to Strength mode once the patient has unlocked
# it via _progression_level. SET_CAP_SECONDS is the per-set 2-minute
# hard cap enforced by the camera loop (Phase C); it doubles here as
# the "worst case time per set" used to project total exercise length
# for the recommendation card.
_SETS_REPS_PER_SET = 12
_SETS_REP_COUNT = 3
_SET_CAP_SECONDS = 120
_HOLD_SECONDS = 300  # 5-min stretch goal; patient ends early on fatigue


def _build_sets(mode: str, progression_level: int) -> List[Dict[str, Any]]:
    """Build the sets[] array for one exercise card given mode + progression.

    Composition rules:
        Functionality (any progression):   3 rep sets
        Strength, level 0 (locked):        3 rep sets (same as functionality)
        Strength, level 1 (unlocked):      3 rep sets + 1 hold finisher

    Each set entry carries enough for the frontend to render a card and
    drive the per-set execution loop (Phase C). `score` is None at
    prescription time and gets filled in after the patient completes
    each set (Phase E).
    """
    sets: List[Dict[str, Any]] = []
    for i in range(_SETS_REP_COUNT):
        sets.append({
            "set_index": i,
            "format": "reps",
            "target_reps": _SETS_REPS_PER_SET,
            "hold_seconds": None,
            "score": None,
        })
    if mode == "strength" and progression_level >= 1:
        sets.append({
            "set_index": len(sets),
            "format": "hold",
            "target_reps": None,
            "hold_seconds": _HOLD_SECONDS,
            "score": None,
        })
    return sets


def _sets_total_seconds(sets: List[Dict[str, Any]]) -> int:
    """Worst-case total duration for an exercise based on its set list.

    Rep sets bill at the camera-loop 2-minute hard cap; hold sets bill
    at their `hold_seconds` ceiling. Used for the recommendation card's
    "this exercise takes up to N minutes" label — the actual timer is
    per-set and lives in the frontend (Phase C).
    """
    total = 0
    for s in sets:
        if s.get("format") == "reps":
            total += _SET_CAP_SECONDS
        elif s.get("format") == "hold":
            total += int(s.get("hold_seconds") or 0)
    return total


def _progression_level(stats: Optional[Dict[str, Any]]) -> int:
    """Per-exercise progression tier for the sets-and-modes feature.

    Returns:
        0 — rep-only baseline (3 sets × 12 reps)
        1 — holds unlocked (3 sets × 12 reps + 1 continuous 5-min hold)

    Criterion for level 1 (sets-and-modes Phase A, 2026-06-04):
        The patient's mean score across all attempts AFTER their first 3
        sessions is at least +30 points higher than the mean of their
        first 3 attempts on THIS specific exercise. Improvement on knee
        extension does not unlock holds for arm raise.

    Why "first 3 attempts" as baseline (not first 1): early sessions are
    contaminated by figuring out the camera, the posture, and the form
    hints. Averaging the first 3 smooths out that learning curve and
    gives a fairer "where they actually started" number for comparison.

    Why +30 points (absolute, not relative): the form score is on a
    0–100 scale and "+30%" in clinical conversation usually means "+30
    percentage points." A patient going from 40% to 70% is meaningfully
    stronger; from 40% to 52% (a relative 30% gain) isn't really.

    Edge case: a patient who scored 95% on their first 3 attempts can
    never gain another +30 (ceiling at 100). They stay at level 0
    forever. That's an acceptable corner case for v1 — at 95% form,
    they're already executing reps near perfectly and the rep-only
    plan continues to serve them. If this comes up clinically we can
    add a "strong baseline → auto-unlock" branch.
    """
    if not stats:
        return 0

    scores = stats.get("scores_oldest_first") or []
    BASELINE_WINDOW = 3
    IMPROVEMENT_THRESHOLD_POINTS = 30.0

    # Need the full 3-attempt baseline AND at least one session past
    # baseline before we can compute improvement at all.
    if len(scores) < BASELINE_WINDOW + 1:
        return 0

    baseline_mean = sum(scores[:BASELINE_WINDOW]) / BASELINE_WINDOW
    recent_scores = scores[BASELINE_WINDOW:]
    recent_mean = sum(recent_scores) / len(recent_scores)

    if (recent_mean - baseline_mean) >= IMPROVEMENT_THRESHOLD_POINTS:
        return 1
    return 0


def recommend_session_v2(
    patient_id: str,
    count: int = 3,
    history_limit: int = 50,
) -> Dict[str, Any]:
    """Build the trajectory-adapted recommendation with both session-mode
    variants populated.

    Returns a dict with shape:
        {
            "patient_id": "...",
            "trajectory": { state, confidence, signals, summary, per_exercise, evidence },
            "action": { action, duration_multiplier, rationale },
            "functionality": { "exercises": [...rep-only cards...] },
            "strength":      { "exercises": [...rep cards + hold finisher where unlocked...] },
            "model_source": "rule_based_trajectory",
        }

    Both variants share the same picked exercise pool — the difference
    is purely the sets[] composition per card. Strength adds the 5-min
    hold finisher for any exercise the patient has unlocked via
    _progression_level. Computing both server-side lets the frontend
    cache them and toggle instantly between modes without re-fetching.
    """
    patient = get_patient_by_id(patient_id)
    if not patient:
        return {
            "patient_id": patient_id,
            "error": "patient_not_found",
            "functionality": {"exercises": []},
            "strength": {"exercises": []},
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
    # NOTE: action["duration_multiplier"] is intentionally not read here
    # anymore — per-exercise improvement now drives duration (see
    # _per_exercise_duration_multiplier). The action still drives
    # exercise selection and intensity labelling.
    # Side guidance appended to each exercise's reasoning so the patient
    # sees a unilateral/bilateral training reminder per card.
    side_note = trajectory.side_guidance(affected_side)

    # Build both Functionality and Strength variants of each picked
    # exercise. The shared identity (id, name, body_area, reasoning) is
    # computed once; sets[] composition is what diverges between modes.
    functionality_exercises: List[Dict[str, Any]] = []
    strength_exercises: List[Dict[str, Any]] = []

    # Acute-phase safety cap (replaces the old per-exercise duration
    # multiplier that was removed when sets[] took over duration). Even
    # if a fresh post-stroke patient is posting Day-3 form scores that
    # would normally unlock the +30%/+60% rep counts and the strength
    # hold finisher, force progression_level=0 so they stay at the safe
    # baseline (12 reps, no hold). Clinical: never push acute patients.
    is_acute = action.get("phase") == "acute"

    for index, ex in enumerate(picked):
        # Per-exercise reasoning: pull this exercise's trajectory stats
        # if it appears in the patient's history. Same for both variants.
        stats = trajectory_result["per_exercise"].get(ex["id"])
        progression_level = 0 if is_acute else _progression_level(stats)

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

        # Shared card identity — mode/sets/duration get added per variant.
        base_card = {
            "id": ex["id"],
            "exercise_type": ex["exercise_type"],
            "name": ex["name"],
            "description": ex["description"],
            "body_area": ex["body_area"],
            "intensity": intensity,
            "difficulty_level": ex["difficulty_level"],
            "focus": ex["focus"],
            "affected_area": affected_area,
            "affected_side": affected_side,
            "session_index": index,
            "reasoning": per_ex_reason,
            "demo_video_path": ex.get("demo_video_path"),
            "progression_level": progression_level,
            "recommendation": {
                "intensity": intensity,
                "focus": ex["focus"],
                "details": {
                    "recommended_sessions_per_week": sessions_per_week,
                    "primary_focus": ex["focus"],
                },
            },
        }

        # Functionality variant — always rep-only, ignores progression
        # (holds are a Strength-mode feature exclusively).
        func_sets = _build_sets("functionality", progression_level)
        func_total = _sets_total_seconds(func_sets)
        functionality_exercises.append({
            **base_card,
            "mode": "functionality",
            "sets": func_sets,
            "set_count": len(func_sets),
            "duration_seconds": func_total,
            "duration_minutes": max(1, int(round(func_total / 60))),
        })

        # Strength variant — same rep baseline; appends the 5-min hold
        # finisher once the patient has unlocked it on this exercise.
        str_sets = _build_sets("strength", progression_level)
        str_total = _sets_total_seconds(str_sets)
        strength_exercises.append({
            **base_card,
            "mode": "strength",
            "sets": str_sets,
            "set_count": len(str_sets),
            "duration_seconds": str_total,
            "duration_minutes": max(1, int(round(str_total / 60))),
        })

    return {
        "patient_id": patient_id,
        "trajectory": trajectory_result,
        "action": action,
        "recovery_phase": action.get("phase"),
        "side_guidance": side_note,
        "functionality": {"exercises": functionality_exercises},
        "strength": {"exercises": strength_exercises},
        "model_source": "rule_based_trajectory",
    }
