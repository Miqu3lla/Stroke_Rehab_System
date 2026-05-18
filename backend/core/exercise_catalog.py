"""Exercise catalog with difficulty ranking — Phase 3 helper.

Pulls the canonical exercise rows from `public.exercises` and overlays a
code-side difficulty ranking the trajectory recommender uses to
downgrade/upgrade. Difficulty lives in code (not the DB) for now because
the catalog is small (3 exercises) and ranking is judgment-call-y.
Promote to a DB column when the catalog grows.

Ranking convention (lower = easier, higher = harder):
    arms: shoulder_flexion (1) → arm_raise (2)
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
# row whose exercise_type isn't listed here gets defaults (level=2, 20min).
DIFFICULTY_OVERLAY: Dict[str, Dict[str, Any]] = {
    "shoulder_flexion": {
        "difficulty_level": 1,
        "base_duration_minutes": 15,
        "focus": "shoulder mobility & form correction",
    },
    "arm_raise": {
        "difficulty_level": 2,
        "base_duration_minutes": 20,
        "focus": "upper-limb strength & coordination",
    },
    "knee_extension": {
        "difficulty_level": 1,
        "base_duration_minutes": 15,
        "focus": "lower-limb strength & quad activation",
    },
    "sit_to_stand": {
        "difficulty_level": 2,
        "base_duration_minutes": 20,
        "focus": "lower-limb strength, balance & gait",
    },
}

DEFAULT_OVERLAY = {
    "difficulty_level": 2,
    "base_duration_minutes": 20,
    "focus": "functional movement",
}


# Exercises the LSTM (StrokeLSTMClassifier in core/neural_network.py) was
# trained on. The training dataset under datasets/Ready_Dataset has
# Correct/Incorrect classes only for these three exercise_types. Sending
# a sequence for any other exercise_type to the LSTM produces an
# out-of-distribution prediction — better to skip the call and rely on
# the live joint-angle score instead.
LSTM_SUPPORTED_EXERCISE_TYPES = frozenset({
    "arm_raise",
    "knee_extension",
    "sit_to_stand",
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
        "SELECT id, exercise_type, display_name, body_area, description "
        "FROM public.exercises"
    )

    # Docker exec
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_pg_config()
        wrapped = f"SELECT json_agg(t) FROM ({query}) t;"
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", wrapped,
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0:
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
        url = f"{supabase_url}/rest/v1/exercises?select=id,exercise_type,display_name,body_area,description"
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
    }


def load_catalog() -> List[Dict[str, Any]]:
    """Return the full decorated catalog (all exercises with difficulty overlays)."""
    raw = _fetch_catalog_rows()
    return [_decorate(row) for row in raw]


def filter_by_area(catalog: List[Dict[str, Any]], affected_area: str) -> List[Dict[str, Any]]:
    """Return exercises whose body_area matches the patient's affected area.

    affected_area ∈ {arms, legs, both}. A patient with affected_area='both'
    sees exercises tagged for arms, legs, or both. A patient with
    affected_area='arms' sees arms-only (and any 'both' rows if they exist).
    """
    area = (affected_area or "both").strip().lower()
    if area == "both":
        return list(catalog)
    return [e for e in catalog if e["body_area"] in {area, "both"}]


def pick_exercises_for_action(
    catalog: List[Dict[str, Any]],
    affected_area: str,
    action: str,
    count: int = 3,
) -> List[Dict[str, Any]]:
    """Select `count` exercises ranked by the trajectory action verb.

    - downgrade: prefer lower difficulty_level (easier).
    - upgrade: prefer higher difficulty_level (harder).
    - maintain: balanced — return mid-difficulty first.

    Falls back to repeating the available exercises if the filtered pool
    is smaller than `count` (which is common with the current 3-exercise
    catalog — the patient sees the same exercises but with adjusted
    duration / intensity tags).
    """
    pool = filter_by_area(catalog, affected_area)
    if not pool:
        return []

    if action == "downgrade":
        ranked = sorted(pool, key=lambda e: e["difficulty_level"])
    elif action == "upgrade":
        ranked = sorted(pool, key=lambda e: -e["difficulty_level"])
    else:
        # maintain: prefer middle, fall back to whatever's available
        ranked = sorted(pool, key=lambda e: abs(e["difficulty_level"] - 2))

    # Pad by repeating the ranked pool when the catalog is small.
    picked: List[Dict[str, Any]] = []
    while len(picked) < count and ranked:
        for ex in ranked:
            picked.append(ex)
            if len(picked) >= count:
                break
    return picked[:count]
