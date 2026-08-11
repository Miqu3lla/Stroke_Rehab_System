"""Exercise catalog with difficulty ranking — Phase 3 helper.

Pulls the canonical exercise rows from `public.exercises` and overlays a
code-side difficulty ranking the trajectory recommender uses to
downgrade/upgrade. Difficulty lives in code (not the DB) for now because
the catalog is small (3 exercises) and ranking is judgment-call-y.
Promote to a DB column when the catalog grows.

Ranking convention (lower = easier, higher = harder):
    arms: shoulder_flexion (1) → hand_to_mouth (2)
    legs: sit_to_stand (1)

Each catalog entry exposes a `difficulty_level` integer plus a
`base_duration_minutes` the recommender scales by trajectory.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional
from urllib import error, request

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:  # pragma: no cover
    psycopg2 = None
    RealDictCursor = None


# Difficulty + duration overlays keyed by exercise_type. The exercise_type
# column has a UNIQUE constraint so it's the safe join key. Any catalog
# row whose exercise_type isn't listed here gets defaults (level=2, 2min).
DIFFICULTY_OVERLAY: Dict[str, Dict[str, Any]] = {
    "shoulder_flexion": {
        "difficulty_level": 1,
        "base_duration_minutes": 2,
        "focus": "shoulder mobility & form correction",
    },
    "hand_to_mouth": {
        "difficulty_level": 2,
        "base_duration_minutes": 2,
        "focus": "upper-limb reach & coordination",
    },
    "knee_extension": {
        "difficulty_level": 1,
        "base_duration_minutes": 2,
        "focus": "lower-limb strength & quad activation",
    },
    "sit_to_stand": {
        "difficulty_level": 2,
        "base_duration_minutes": 2,
        "focus": "lower-limb strength, balance & gait",
    },
}

DEFAULT_OVERLAY = {
    "difficulty_level": 2,
    "base_duration_minutes": 2,
    "focus": "functional movement",
}


# Exercises the LSTM (StrokeLSTMClassifier in core/neural_network.py) was
# trained on. The training dataset under datasets/Ready_Dataset has
# Correct/Incorrect clips for these exercise_types. Sending a sequence
# for any other exercise_type to the LSTM produces an out-of-distribution
# prediction — better to skip the call and rely on the live joint-angle
# score instead.
#
# 2026-07-30: retrained after the therapist swapped arm_raise for the new
# hand_to_mouth exercise (arm_raise was too similar to shoulder_flexion).
# Moved to per-exercise models (one specialized classifier per movement;
# see core/neural_network.py). Held-out test accuracy after the swap:
#   shoulder_flexion 73% (per-exercise), hand_to_mouth 71% (per-exercise).
# sit_to_stand now has its own per-exercise model too (2026-08-11): the old
# "87% global fallback" figure was unbacked (real global test was 66%); the
# Kaggle sit_to_stand clips were re-integrated and trained standalone —
# last-timestep readout, 86.67% held-out test (TP9/TN4/FP2/FN0).
# knee_extension uses a HYBRID (2026-08-10): a max-pool LSTM (readout wired in
# core/neural_network.POOLED_READOUT_SLUGS) trained on the re-recorded data, plus
# a geometric veto — a rep that never sustains near-full knee extension is scored
# incorrect regardless of the LSTM. Max-pool made the transient mid-clip peak
# learnable (last-timestep readout stalled at 50%), and the veto closes its one
# confident false positive. Hybrid = 100% on the held-out test (LSTM alone 87.5%).
LSTM_SUPPORTED_EXERCISE_TYPES = frozenset({
    "shoulder_flexion",
    "hand_to_mouth",
    "sit_to_stand",
    "knee_extension",
})


def is_lstm_supported(exercise_type: str) -> bool:
    """Return True when the LSTM classifier can be trusted for this exercise."""
    return (exercise_type or "").strip().lower() in LSTM_SUPPORTED_EXERCISE_TYPES


def _get_pg_config() -> Dict[str, str]:
    return {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": os.getenv("POSTGRES_PORT", "5432"),
        "dbname": os.getenv("POSTGRES_DB", "postgres"),
        "user": os.getenv("POSTGRES_USER", "supabase_admin"),
        "password": os.getenv("POSTGRES_PASSWORD", ""),
    }


def _fetch_catalog_rows() -> List[Dict[str, Any]]:
    """Return all rows from `public.exercises`. Tries docker → psycopg2 → REST."""
    query = (
        "SELECT id, exercise_type, display_name, body_area, description, demo_video_path "
        "FROM public.exercises"
    )

    # Docker exec. load_catalog() runs inline on the recommendation
    # request path, so a hung daemon/container must not block the API
    # thread indefinitely — the timeout falls through to psycopg2/REST.
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_pg_config()
        wrapped = f"SELECT json_agg(t) FROM ({query}) t;"
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", wrapped,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=5)
        except subprocess.TimeoutExpired:
            result = None
        if result is not None and result.returncode == 0:
            # json_agg may wrap onto multiple lines for large arrays — join
            # everything (stripped) before parsing.
            output = " ".join(line.strip() for line in result.stdout.splitlines() if line.strip())
            if output and output != "null":
                try:
                    return json.loads(output) or []
                except Exception:
                    pass

    # psycopg2 direct
    if psycopg2 is not None:
        config = _get_pg_config()
        if config.get("password"):
            try:
                with psycopg2.connect(
                    host=config["host"], port=config["port"], dbname=config["dbname"],
                    user=config["user"], password=config["password"],
                    cursor_factory=RealDictCursor,
                ) as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(query)
                        return [dict(row) for row in cursor.fetchall()]
            except Exception:
                pass

    # REST fallback
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if supabase_url and service_key:
        url = f"{supabase_url}/rest/v1/exercises?select=id,exercise_type,display_name,body_area,description,demo_video_path"
        req = request.Request(url, headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }, method="GET")
        try:
            with request.urlopen(req, timeout=10) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else []
        except Exception:
            return []
    return []


def _decorate(row: Dict[str, Any]) -> Dict[str, Any]:
    """Overlay difficulty + duration onto a raw catalog row."""
    overlay = DIFFICULTY_OVERLAY.get(row.get("exercise_type", ""), DEFAULT_OVERLAY)
    return {
        "id": row.get("id"),
        "exercise_type": row.get("exercise_type"),
        "name": row.get("display_name"),
        "body_area": row.get("body_area"),
        "description": row.get("description") or "",
        "difficulty_level": overlay["difficulty_level"],
        "base_duration_minutes": overlay["base_duration_minutes"],
        "focus": overlay["focus"],
        # demo_video_path is the storage-relative filename (e.g.
        # "shoulder_flexion.mp4"). The frontend builds the full URL via
        # supabase.storage.from('exercise-demos').getPublicUrl(path) so
        # the host adapts to dev vs prod automatically.
        "demo_video_path": row.get("demo_video_path"),
    }


def load_catalog() -> List[Dict[str, Any]]:
    """Return the full decorated catalog (all exercises with difficulty overlays)."""
    raw = _fetch_catalog_rows()
    return [_decorate(row) for row in raw]


def filter_by_area(catalog: List[Dict[str, Any]], affected_area: str) -> List[Dict[str, Any]]:
    """Return exercises STRICTLY matching the patient's affected area.

    - 'arms' → only body_area='arms' rows (no legs, no cross-body)
    - 'legs' → only body_area='legs' rows (no arms, no cross-body)
    - 'both' → every exercise in the catalog
    """
    area = (affected_area or "both").strip().lower()
    if area == "both":
        return list(catalog)
    return [e for e in catalog if e.get("body_area") == area]


def _rank_for_action(pool: List[Dict[str, Any]], action: str) -> List[Dict[str, Any]]:
    """Order a pool by difficulty according to the trajectory action verb."""
    if action == "downgrade":
        return sorted(pool, key=lambda e: e["difficulty_level"])
    if action == "upgrade":
        return sorted(pool, key=lambda e: -e["difficulty_level"])
    # maintain: prefer middle difficulty first, then taper outward
    return sorted(pool, key=lambda e: abs(e["difficulty_level"] - 2))


def pick_exercises_for_action(
    catalog: List[Dict[str, Any]],
    affected_area: str,
    action: str,
    count: int = 3,
) -> List[Dict[str, Any]]:
    """Select up to `count` exercises for the patient's daily session.

    Body-area rules (enforced strictly):
      - affected_area='arms' → ONLY arm exercises, never a leg
      - affected_area='legs' → ONLY leg exercises, never an arm
      - affected_area='both' → INTERLEAVE arm + leg (slot 0 = arm,
        slot 1 = leg, …) so the patient gets a guaranteed mix.
        If one pool runs out, the remaining slots are filled from the
        other pool — still without duplication.

    Difficulty rules (within each body-area pool):
      - downgrade → easier first (lower difficulty_level)
      - upgrade → harder first
      - maintain → mid-difficulty first

    Duplicate rule (applies to ALL branches): an exercise is never
    repeated within the returned list. If the available unique pool is
    smaller than `count`, returns fewer items — the frontend renders
    however many are available.
    """
    area = (affected_area or "both").strip().lower()

    # ── Both affected: interleave arm/leg picks, no duplicates ──────────
    if area == "both":
        arm_pool = _rank_for_action(filter_by_area(catalog, "arms"), action)
        leg_pool = _rank_for_action(filter_by_area(catalog, "legs"), action)
        if not arm_pool and not leg_pool:
            return []

        picked: List[Dict[str, Any]] = []
        i_arm, i_leg = 0, 0
        emit_arm_first = len(arm_pool) >= len(leg_pool)
        # Walk both pools without wrapping — each exercise is taken at
        # most once. When one pool is exhausted, drain the other.
        while len(picked) < count and (i_arm < len(arm_pool) or i_leg < len(leg_pool)):
            if emit_arm_first:
                if i_arm < len(arm_pool):
                    picked.append(arm_pool[i_arm])
                    i_arm += 1
                    if len(picked) >= count:
                        break
                if i_leg < len(leg_pool):
                    picked.append(leg_pool[i_leg])
                    i_leg += 1
            else:
                if i_leg < len(leg_pool):
                    picked.append(leg_pool[i_leg])
                    i_leg += 1
                    if len(picked) >= count:
                        break
                if i_arm < len(arm_pool):
                    picked.append(arm_pool[i_arm])
                    i_arm += 1
        return picked[:count]

    # ── Single body-area patient: STRICT filter, unique only ────────────
    # Only return unique exercises — no duplicates even if catalog is small.
    # The frontend will show however many are available (up to count).
    ranked = _rank_for_action(filter_by_area(catalog, area), action)
    return ranked[:count]
