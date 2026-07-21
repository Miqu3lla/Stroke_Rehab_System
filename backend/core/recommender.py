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


# ── Sets-and-modes feature constants ───────────────────────────────────
# Redefined 2026-07 per the therapist's spec. Both modes are 3 sets × 12
# reps; what differs is the load type:
#
#   Functionality — "hold and reps": each rep is held 6-12s in the target
#     band before it counts, then counted by reps. Emphasis is TOLERANCE
#     (sustained control), not load.
#   Strength — "by reps only and by kilograms": plain reps performed with
#     external weight, and the prescribed weight PROGRESSES as the patient
#     improves.
#
# This inverts the earlier design (which put a hold finisher in Strength);
# holds now belong to Functionality, and weight belongs to Strength.
_SETS_REPS_PER_SET = 12
_SETS_REP_COUNT = 3
_REP_SET_CAP_SECONDS = 120  # per-set hard cap for plain rep sets (Strength)

# Functionality holds. A rep counts once the patient sustains the green
# band for _FUNC_HOLD_SECONDS_PER_REP; _FUNC_HOLD_SECONDS_MAX is the
# encouraged upper bound shown to the patient. The per-set cap is higher
# than a plain rep set because each rep now carries a multi-second hold.
_FUNC_HOLD_SECONDS_PER_REP = 6
_FUNC_HOLD_SECONDS_MAX = 12
_FUNC_SET_CAP_SECONDS = 180

# Strength load. The camera cannot measure kilograms, so weight is
# patient-entered; the recommender only SUGGESTS the next value. Start at a
# light hand weight, and bump by one increment once the exercise's recent
# average form has improved by _STRENGTH_IMPROVEMENT_THRESHOLD over the
# patient's baseline (therapist: "if patients improve ~20-25% ... increment
# a little"). Weight applies ONLY to upper-limb exercises — you load a bicep
# curl / arm raise with a hand weight, not a knee extension — so leg Strength
# work stays reps-only (see _STRENGTH_WEIGHTED_AREAS).
_STRENGTH_START_KG = 0.5
_STRENGTH_INCREMENT_KG = 0.5
_STRENGTH_IMPROVEMENT_THRESHOLD = 0.20
_STRENGTH_WEIGHTED_AREAS = {"arms"}
# Safety ceiling on the auto-suggested load. Form data alone should never
# advise a stroke patient toward a heavy weight; they can still dial in more
# by hand on the in-session stepper if their therapist approves.
_STRENGTH_MAX_KG = 10.0

# Shared baseline window: the first N attempts on an exercise define the
# "where they started" reference for both hold/weight progression.
BASELINE_WINDOW = 3


def _build_sets(
    mode: str,
    suggested_weight_kg: Optional[float] = None,
    supports_weight: bool = True,
) -> List[Dict[str, Any]]:
    """Build the sets[] array for one exercise card.

    Both modes are 3 sets × 12 reps (format 'reps'); the mode-specific
    fields differ:
        Functionality → hold_seconds_per_rep / hold_seconds_max (tolerance holds)
        Strength      → target_weight_kg (external load, patient-entered)

    `supports_weight` gates the Strength load: it's True for upper-limb
    exercises (hand weights) and False for leg exercises, which stay
    reps-only (target_weight_kg = None). `score` is None at prescription
    time and is filled in after each set completes.
    """
    sets: List[Dict[str, Any]] = []
    for i in range(_SETS_REP_COUNT):
        entry: Dict[str, Any] = {
            "set_index": i,
            "format": "reps",
            "target_reps": _SETS_REPS_PER_SET,
            "score": None,
        }
        if mode == "strength":
            entry["hold_seconds_per_rep"] = None
            entry["hold_seconds_max"] = None
            if supports_weight:
                entry["target_weight_kg"] = (
                    _STRENGTH_START_KG if suggested_weight_kg is None
                    else round(float(suggested_weight_kg), 1)
                )
            else:
                entry["target_weight_kg"] = None
        else:  # functionality (default)
            entry["hold_seconds_per_rep"] = _FUNC_HOLD_SECONDS_PER_REP
            entry["hold_seconds_max"] = _FUNC_HOLD_SECONDS_MAX
            entry["target_weight_kg"] = None
        sets.append(entry)
    return sets


def _sets_total_seconds(sets: List[Dict[str, Any]]) -> int:
    """Worst-case total duration for an exercise based on its set list.

    Functionality rep sets (with per-rep holds) bill at the higher hold
    cap; plain Strength rep sets bill at the standard rep cap. Used for the
    recommendation card's "up to N minutes" label — the real timer is
    per-set and lives in the frontend.
    """
    total = 0
    for s in sets:
        if s.get("hold_seconds_per_rep"):
            total += _FUNC_SET_CAP_SECONDS
        else:
            total += _REP_SET_CAP_SECONDS
    return total


def _suggested_weight_kg(stats: Optional[Dict[str, Any]]) -> float:
    """Suggest the next Strength load (kg) for an exercise from its history.

    Builds on the weight the patient last actually used, and adds ONE
    increment only when their most recent window of form scores improved over
    the window immediately before it — a rolling comparison, capped at
    _STRENGTH_MAX_KG.

    Why rolling and not "vs the first-N baseline": a frozen baseline re-fires
    the bump on EVERY session for as long as the patient stays above it, so a
    patient who improved once and then held steady would have their weight
    ratcheted up without end. Comparing consecutive windows instead grants one
    step per genuine improvement and then stops once they plateau at the new
    load (their post-bump scores become the new prior window). Continued real
    improvement still progresses the weight session over session, as intended.
    """
    if not stats:
        return _STRENGTH_START_KG

    last_weight = stats.get("last_weight_kg")
    last_weight = float(last_weight) if last_weight is not None else _STRENGTH_START_KG

    scores = stats.get("scores_oldest_first") or []
    # Need a full window at the current level PLUS the preceding window to
    # measure fresh improvement.
    if len(scores) < 2 * BASELINE_WINDOW:
        return round(min(last_weight, _STRENGTH_MAX_KG), 1)

    prior = scores[-2 * BASELINE_WINDOW:-BASELINE_WINDOW]
    recent = scores[-BASELINE_WINDOW:]
    prior_mean = sum(prior) / len(prior)
    recent_mean = sum(recent) / len(recent)
    if prior_mean > 0 and (recent_mean - prior_mean) / prior_mean >= _STRENGTH_IMPROVEMENT_THRESHOLD:
        return round(min(last_weight + _STRENGTH_INCREMENT_KG, _STRENGTH_MAX_KG), 1)
    return round(min(last_weight, _STRENGTH_MAX_KG), 1)


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

        # Strength load only applies to upper-limb exercises — you load a
        # bicep curl / arm raise with a hand weight, not a knee extension.
        # Leg exercises stay reps-only in Strength mode.
        supports_weight = (ex.get("body_area") or "").strip().lower() in _STRENGTH_WEIGHTED_AREAS

        # Strength load suggestion. Acute patients never get a load bump —
        # hold whatever they last used (or the light baseline if none).
        # Everyone else progresses on sustained form improvement.
        if is_acute:
            _last_w = stats.get("last_weight_kg") if stats else None
            suggested_weight = float(_last_w) if _last_w is not None else _STRENGTH_START_KG
        else:
            suggested_weight = _suggested_weight_kg(stats)

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

        # Functionality variant — tolerance holds: each rep held 6-12s in
        # the target band before it counts.
        func_sets = _build_sets("functionality")
        func_total = _sets_total_seconds(func_sets)
        functionality_exercises.append({
            **base_card,
            "mode": "functionality",
            "sets": func_sets,
            "set_count": len(func_sets),
            "hold_seconds_per_rep": _FUNC_HOLD_SECONDS_PER_REP,
            "hold_seconds_max": _FUNC_HOLD_SECONDS_MAX,
            "duration_seconds": func_total,
            "duration_minutes": max(1, int(round(func_total / 60))),
        })

        # Strength variant — plain reps, loaded with a hand weight for
        # upper-limb exercises only. The suggested weight is what the app
        # pre-fills; the patient edits it to the weight they actually used,
        # which becomes next session's baseline. Leg exercises omit the
        # weight fields entirely (reps-only).
        str_sets = _build_sets(
            "strength",
            suggested_weight_kg=suggested_weight,
            supports_weight=supports_weight,
        )
        str_total = _sets_total_seconds(str_sets)
        strength_card = {
            **base_card,
            "mode": "strength",
            "sets": str_sets,
            "set_count": len(str_sets),
            "duration_seconds": str_total,
            "duration_minutes": max(1, int(round(str_total / 60))),
        }
        if supports_weight:
            strength_card["suggested_weight_kg"] = round(float(suggested_weight), 1)
            strength_card["weight_increment_kg"] = _STRENGTH_INCREMENT_KG
        strength_exercises.append(strength_card)

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
