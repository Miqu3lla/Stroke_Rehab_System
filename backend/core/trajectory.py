"""Recovery-trajectory analyzer — Phase 2 ("the Brain") of the adaptive
recommender.

The vision (Patient X scenario) calls for an LSTM-driven trajectory model
that classifies a patient as progressing / plateauing / deteriorating and
fires signals like rapid_drop, strength_gain, and fatigue_pattern. We
don't yet have trajectory training data, so this module implements the
same interface with deterministic rules over the patient's
recommendation_logs history. When a trained LSTM exists, swap the
internals of `analyze_trajectory()` without changing the contract.

Inputs come from `supabase_db.fetch_patient_history()` — a flat list of
scored sessions, newest first, each row: {exercise_id, exercise_name,
ended_via, latest_form_score, duration_seconds, created_at, ...}.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


# ── Tunables ────────────────────────────────────────────────────────────
MIN_SESSIONS_FOR_TREND = 3       # need ≥3 to call a trend at all
RAPID_DROP_DELTA = 20.0          # latest score is N points below recent mean
STRENGTH_GAIN_DELTA = 15.0       # latest score is N points above recent mean
PROGRESSING_SLOPE = 3.0          # avg per-session slope (points) ≥ this
DETERIORATING_SLOPE = -3.0       # avg per-session slope (points) ≤ this
FATIGUE_QUIT_RATIO = 0.4         # ≥40% of recent sessions ended_early
SUSTAINED_HIGH_THRESHOLD = 80.0  # score considered "strong"
SUSTAINED_HIGH_COUNT = 3         # consecutive strong sessions needed


# ── Helpers ─────────────────────────────────────────────────────────────
def _parse_ts(ts: Any) -> Optional[datetime]:
    if isinstance(ts, datetime):
        return ts
    if not isinstance(ts, str) or not ts:
        return None
    # Postgres timestamptz looks like '2026-05-18 06:38:31.367269+00' or ISO
    try:
        normalized = ts.replace(" ", "T")
        if normalized.endswith("+00"):
            normalized = normalized + ":00"
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        return datetime.fromisoformat(normalized)
    except Exception:
        return None


def _linear_slope(scores_oldest_first: List[float]) -> float:
    """Return least-squares slope (points per session). 0 if fewer than 2."""
    n = len(scores_oldest_first)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(scores_oldest_first) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, scores_oldest_first))
    den = sum((x - mean_x) ** 2 for x in xs) or 1.0
    return num / den


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# ── Per-exercise analysis ───────────────────────────────────────────────
def _analyze_per_exercise(history: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Bucket history by exercise_id and compute a trend per bucket.

    History is newest-first; we reverse within each bucket so slope reads
    chronologically.
    """
    by_exercise: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in history:
        eid = row.get("exercise_id")
        if not eid:
            continue
        by_exercise[eid].append(row)

    result: Dict[str, Dict[str, Any]] = {}
    for eid, rows in by_exercise.items():
        rows_oldest_first = list(reversed(rows))
        scores = [_safe_float(r.get("latest_form_score")) for r in rows_oldest_first]
        end_early = sum(1 for r in rows if (r.get("ended_via") or "") == "end_early")
        slope = _linear_slope(scores[-5:])  # last 5 of this exercise

        # Most recent Strength weight logged for this exercise, so the
        # recommender can progress the load from where the patient last was.
        # `rows` is newest-first. A missing weight is None (REST path) or a
        # -1 sentinel (SQL COALESCE) — both mean "no weight logged" and are
        # skipped so Functionality sessions never seed a Strength weight.
        last_weight_kg = None
        for r in rows:
            w = r.get("weight_kg")
            if w is None:
                continue
            w = _safe_float(w)
            if w >= 0:
                last_weight_kg = w
                break

        # Don't assign a directional trend until this specific exercise
        # has enough sessions of its own. Without this guard, a single
        # session on each of three different exercises would each look
        # like a "rising" or "falling" bucket and bubble up into a
        # full-patient classification even though no individual exercise
        # has enough data to support that.
        if not scores:
            trend = "unknown"
        elif len(scores) < MIN_SESSIONS_FOR_TREND:
            trend = "unknown"
        elif slope >= PROGRESSING_SLOPE:
            trend = "rising"
        elif slope <= DETERIORATING_SLOPE:
            trend = "falling"
        else:
            trend = "flat"

        result[eid] = {
            "exercise_id": eid,
            "exercise_name": rows[0].get("exercise_name") or "",
            "sessions": len(rows),
            "scores_oldest_first": scores,
            "latest_score": scores[-1] if scores else None,
            "mean_score": round(sum(scores) / len(scores), 2) if scores else None,
            "slope_per_session": round(slope, 3),
            "trend": trend,
            "end_early_count": end_early,
            "end_early_ratio": round(end_early / len(rows), 3) if rows else 0.0,
            "last_weight_kg": last_weight_kg,
        }
    return result


# ── Signals (Patient X triggers) ────────────────────────────────────────
def _detect_signals(history: List[Dict[str, Any]], per_exercise: Dict[str, Dict[str, Any]]) -> List[str]:
    signals: List[str] = []
    if not history:
        return signals

    recent = history[: max(MIN_SESSIONS_FOR_TREND, 5)]
    recent_scores = [_safe_float(r.get("latest_form_score")) for r in recent]
    recent_quits = sum(1 for r in recent if (r.get("ended_via") or "") == "end_early")

    # rapid_drop — most recent score is much below the recent mean
    if len(recent_scores) >= MIN_SESSIONS_FOR_TREND:
        latest = recent_scores[0]
        prior_mean = sum(recent_scores[1:]) / max(1, len(recent_scores) - 1)
        if prior_mean - latest >= RAPID_DROP_DELTA:
            signals.append("rapid_drop")
        if latest - prior_mean >= STRENGTH_GAIN_DELTA:
            signals.append("strength_gain")

    # fatigue_pattern — many recent sessions ended early
    if recent and recent_quits / len(recent) >= FATIGUE_QUIT_RATIO:
        signals.append("fatigue_pattern")

    # sustained_high — last N consecutive sessions ≥ threshold
    if len(recent_scores) >= SUSTAINED_HIGH_COUNT:
        if all(s >= SUSTAINED_HIGH_THRESHOLD for s in recent_scores[:SUSTAINED_HIGH_COUNT]):
            signals.append("sustained_high")

    # per-exercise deterioration on any tracked exercise → escalate
    for stats in per_exercise.values():
        if stats["trend"] == "falling" and stats["sessions"] >= MIN_SESSIONS_FOR_TREND:
            signals.append("per_exercise_decline")
            break

    return signals


# ── State classification ────────────────────────────────────────────────
def _classify_state(per_exercise: Dict[str, Dict[str, Any]], signals: List[str]) -> Dict[str, Any]:
    if not per_exercise:
        return {"state": "insufficient_data", "confidence": 0.0}

    trends = [v["trend"] for v in per_exercise.values()]
    rising = sum(1 for t in trends if t == "rising")
    falling = sum(1 for t in trends if t == "falling")
    flat = sum(1 for t in trends if t == "flat")
    unknown = sum(1 for t in trends if t == "unknown")
    total = len(trends)
    sample_sessions = sum(v["sessions"] for v in per_exercise.values())
    # A bucket only "counts" toward a state classification once it has
    # MIN_SESSIONS_FOR_TREND sessions of its own. Three one-off sessions
    # across three different exercises must not classify as anything
    # other than insufficient_data.
    qualifying_buckets = sum(
        1 for v in per_exercise.values() if v["sessions"] >= MIN_SESSIONS_FOR_TREND
    )

    # If no bucket has enough sessions yet, bail out as insufficient_data
    # regardless of how many one-off sessions we've accumulated overall.
    if qualifying_buckets == 0:
        return {
            "state": "insufficient_data",
            "confidence": max(0.1, 0.05 * sample_sessions),
        }

    # Hard overrides from signals (these signals already use per-bucket
    # context via _detect_signals, so they're safe to trust here).
    if "rapid_drop" in signals or "fatigue_pattern" in signals:
        state = "deteriorating"
    elif "sustained_high" in signals or "strength_gain" in signals:
        state = "progressing"
    elif falling > rising and falling >= max(1, total // 2):
        state = "deteriorating"
    elif rising > falling and rising >= max(1, total // 2):
        state = "progressing"
    elif flat + unknown == total:
        state = "plateauing"
    else:
        state = "plateauing"

    # Confidence scales with how much evidence we have.
    confidence = min(1.0, 0.3 + 0.1 * sample_sessions)
    if sample_sessions < MIN_SESSIONS_FOR_TREND:
        state = "insufficient_data"
        confidence = max(0.1, 0.05 * sample_sessions)

    return {"state": state, "confidence": round(confidence, 3)}


def _build_summary(state: str, signals: List[str], per_exercise: Dict[str, Dict[str, Any]]) -> str:
    if state == "insufficient_data":
        return "Not enough scored sessions yet — collecting baseline."

    # Pick the most-tracked exercise as the headline
    headline_stats = None
    if per_exercise:
        headline_stats = max(per_exercise.values(), key=lambda v: v["sessions"])

    base = {
        "progressing": "Patient is progressing",
        "plateauing": "Patient is holding steady",
        "deteriorating": "Patient is struggling",
    }.get(state, "Trajectory unclear")

    parts = [base]
    if headline_stats:
        parts.append(
            f"({headline_stats['exercise_name'] or 'tracked exercise'}: "
            f"latest {headline_stats['latest_score']}, "
            f"mean {headline_stats['mean_score']}, "
            f"slope {headline_stats['slope_per_session']:+.1f}/session)"
        )
    if signals:
        parts.append("Signals: " + ", ".join(signals))
    return ". ".join(parts) + "."


# ── Public API ──────────────────────────────────────────────────────────
def analyze_trajectory(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Phase 2 entry point. Given a flat history list, return the brain's
    verdict on where the patient is in their recovery curve.

    Returns:
        {
            "state": "progressing" | "plateauing" | "deteriorating" | "insufficient_data",
            "confidence": float,
            "signals": list[str],
            "per_exercise": {exercise_id: {trend, slope, latest_score, ...}},
            "summary": "...",
            "evidence": {"total_sessions": int, "scored_sessions": int, ...},
        }
    """
    scored = [r for r in history if r.get("latest_form_score") is not None]
    per_exercise = _analyze_per_exercise(scored)
    signals = _detect_signals(scored, per_exercise)
    classification = _classify_state(per_exercise, signals)

    # Lookback window in days for evidence reporting
    days_span = None
    if scored:
        latest_ts = _parse_ts(scored[0].get("created_at"))
        oldest_ts = _parse_ts(scored[-1].get("created_at"))
        if latest_ts and oldest_ts:
            days_span = (latest_ts - oldest_ts).days

    return {
        "state": classification["state"],
        "confidence": classification["confidence"],
        "signals": signals,
        "per_exercise": per_exercise,
        "summary": _build_summary(classification["state"], signals, per_exercise),
        "evidence": {
            "scored_sessions": len(scored),
            "tracked_exercises": len(per_exercise),
            "days_span": days_span,
        },
    }


def trajectory_to_action(state: str, signals: List[str]) -> Dict[str, Any]:
    """Map Phase-2 output to a Phase-3 action verb the recommender uses.

    Returns:
        {
            "action": "downgrade" | "maintain" | "upgrade",
            "duration_multiplier": float,  # adjust exercise length
            "rationale": str,
        }
    """
    if state == "deteriorating" or "rapid_drop" in signals or "fatigue_pattern" in signals:
        return {
            "action": "downgrade",
            "duration_multiplier": 0.75,
            "rationale": (
                "Patient is struggling — switching to easier exercises and shorter sets "
                "to rebuild confidence and base strength."
            ),
        }
    if state == "progressing" or "sustained_high" in signals or "strength_gain" in signals:
        return {
            "action": "upgrade",
            "duration_multiplier": 1.15,
            "rationale": (
                "Patient is gaining strength — pushing toward harder exercises and "
                "longer sets to keep building."
            ),
        }
    if state == "insufficient_data":
        return {
            "action": "maintain",
            "duration_multiplier": 1.0,
            "rationale": "Establishing a baseline — starting with foundational exercises.",
        }
    return {
        "action": "maintain",
        "duration_multiplier": 1.0,
        "rationale": "Patient is holding steady — same difficulty, rotating focus to avoid plateau.",
    }


# ── Recovery-phase modulation (uses patients.months_in_recovery) ────────
def recovery_phase(months_in_recovery: int) -> str:
    """Bucket the patient's months-in-recovery into a clinical phase.

    acute (<2 months): just out of hospital, must not be pushed hard.
    subacute (2–5): standard rehab window, trajectory drives everything.
    chronic (≥6): plateau-prone, can be pushed harder on upgrades.
    """
    months = int(months_in_recovery or 0)
    if months < 2:
        return "acute"
    if months < 6:
        return "subacute"
    return "chronic"


def apply_phase_modifier(action: Dict[str, Any], months_in_recovery: int) -> Dict[str, Any]:
    """Modulate a trajectory action by the patient's recovery phase.

    Acute patients are capped to maintain/downgrade no matter what
    trajectory suggests — early-recovery upgrades on rule-based signals
    are clinically risky. Chronic patients get a small duration boost on
    upgrades because they can handle the load and need progressive
    overload to keep gaining.

    Returns a new action dict with extra fields: `phase` and (if
    modulated) `original_action` so the rationale stays traceable.
    """
    phase = recovery_phase(months_in_recovery)
    modulated = dict(action)
    modulated["phase"] = phase
    modulated["months_in_recovery"] = int(months_in_recovery or 0)

    if phase == "acute":
        # Cap aggression. Even if trajectory said upgrade, hold the line.
        original = action.get("action")
        if original == "upgrade":
            modulated["action"] = "maintain"
            modulated["duration_multiplier"] = min(0.9, float(action.get("duration_multiplier") or 1.0))
            modulated["original_action"] = "upgrade"
            modulated["rationale"] = (
                f"Patient is {months_in_recovery} month(s) post-stroke (acute phase). "
                "Trajectory suggested an upgrade, but we're holding steady to avoid "
                "overload this early in recovery."
            )
        else:
            # Even on maintain/downgrade, keep durations conservative for acute.
            modulated["duration_multiplier"] = min(0.9, float(action.get("duration_multiplier") or 1.0))
            if original != "downgrade":
                modulated["rationale"] = (
                    f"Patient is {months_in_recovery} month(s) post-stroke (acute phase). "
                    + str(action.get("rationale") or "")
                ).strip()
        return modulated

    if phase == "chronic" and action.get("action") == "upgrade":
        # Slight extra push for chronic patients who are actually progressing.
        modulated["duration_multiplier"] = float(action.get("duration_multiplier") or 1.0) * 1.05
        modulated["rationale"] = (
            f"Patient is {months_in_recovery}+ months post-stroke (chronic phase). "
            + str(action.get("rationale") or "")
        ).strip()
        return modulated

    # subacute or chronic-but-not-upgrading: no modulation.
    return modulated


def side_guidance(affected_side: str) -> str:
    """Return a short per-exercise guidance string based on weaker side.

    Used to append context to each exercise's `reasoning` so the dashboard
    can remind the patient to weight the weaker limb on unilateral reps.
    """
    side = (affected_side or "").strip().lower()
    if side == "left":
        return "Emphasize unilateral reps on your weaker left side."
    if side == "right":
        return "Emphasize unilateral reps on your weaker right side."
    if side == "both":
        return "Bilateral weakness — work both sides evenly across reps."
    return ""
