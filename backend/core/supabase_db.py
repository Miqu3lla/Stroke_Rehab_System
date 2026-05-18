"""Persistence helpers for local development and Supabase.

This module provides multiple ways to persist data created by the
FastAPI backend during development:

- Direct `psycopg2` connection to a Postgres instance (when host access
    is available and credentials are configured).
- A `docker exec` fallback that runs `psql` inside the running
    `supabase-db` container. This avoids host-side Postgres auth/mapping
    issues when the container is the canonical source of truth.
- A Supabase REST fallback via Kong (HTTP) when configured.

The helpers return standardized dicts describing `stored`, `status_code`,
and `data` so calling code can treat results uniformly.
"""

import json
import os
import re
import shutil
import subprocess
from typing import Any, Dict, Optional
from urllib import error, request

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
    from psycopg2.extensions import adapt
except ImportError:  # pragma: no cover - dependency is installed in the backend env
    psycopg2 = None
    Json = None
    RealDictCursor = None
    adapt = None


def _get_supabase_url() -> str:
    """Return the configured SUPABASE_URL or a sensible local default.

    The returned URL is used when constructing REST fallback requests to
    the Supabase PostgREST endpoint (via Kong).
    """
    return os.getenv("SUPABASE_URL", "http://localhost:8000")


def _get_service_role_key() -> str:
    """Return the Supabase service role key used for REST auth.

    This value is optional for local-only docker interactions but required
    when calling the Supabase REST API.
    """
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _get_postgres_config() -> Dict[str, str]:
    """Gather Postgres connection configuration from environment.

    Keys: host, port, dbname, user, password.
    """
    return {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": os.getenv("POSTGRES_PORT", "5432"),
        "dbname": os.getenv("POSTGRES_DB", "postgres"),
        "user": os.getenv("POSTGRES_USER", "supabase_admin"),
        "password": os.getenv("POSTGRES_PASSWORD", ""),
    }


def _configured() -> bool:
    """Return True when a Supabase REST URL + service key are present."""
    url = _get_supabase_url() or ""
    key = _get_service_role_key() or ""
    return bool(url.strip()) and bool(key.strip())


def _postgres_configured() -> bool:
    """Return True when Postgres credential (password) is configured."""
    config = _get_postgres_config()
    return bool(config["password"].strip())


def _quote_sql_value(value: Any) -> str:
    """Safely quote a Python value for inline SQL when using `psql`.

    This is used only by the `docker exec` path where we build a
    single-line SQL statement passed to `psql -c`.
    """
    if adapt is None:
        raise RuntimeError("psycopg2_adapt_unavailable")
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list)):
        return f"{adapt(json.dumps(value)).getquoted().decode('utf-8')}::jsonb"
    return adapt(value).getquoted().decode("utf-8")


def _rest_url(table_name: str) -> str:
    """Return the full PostgREST URL for a given table name."""
    url = _get_supabase_url()
    return f"{url.rstrip('/')}/rest/v1/{table_name}"


def _headers() -> Dict[str, str]:
    """Return headers required for Supabase REST requests (service role)."""
    key = _get_service_role_key()
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _postgres_insert(table_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Attempt a direct Postgres insert using `psycopg2`.

    Returns a dict documenting success/failure and any returned row data.
    """
    if psycopg2 is None:
        return {"stored": False, "reason": "psycopg2_not_installed"}

    if not _postgres_configured():
        return {"stored": False, "reason": "postgres_not_configured"}

    config = _get_postgres_config()
    insert_columns = ", ".join(payload.keys())
    placeholders = ", ".join(["%s"] * len(payload))
    values = []
    for value in payload.values():
        if isinstance(value, dict):
            values.append(Json(value))
        else:
            values.append(value)

    query = f"INSERT INTO public.{table_name} ({insert_columns}) VALUES ({placeholders}) RETURNING *"

    try:
        with psycopg2.connect(
            host=config["host"],
            port=config["port"],
            dbname=config["dbname"],
            user=config["user"],
            password=config["password"],
            cursor_factory=RealDictCursor,
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, values)
                row = cursor.fetchone()
                conn.commit()
                return {"stored": True, "status_code": 201, "data": [dict(row) if row is not None else {}]}
    except Exception as exc:
        return {"stored": False, "error": str(exc)}


def _docker_postgres_insert(table_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Insert by running `psql` inside the running Supabase DB container.

    This path is chosen when host-level Postgres connections fail due to
    port mapping or authentication differences; it runs `docker exec`
    and returns the inserted row id (if any).
    """
    if shutil.which("docker") is None:
        return {"stored": False, "reason": "docker_not_installed"}

    container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
    config = _get_postgres_config()

    # Build a safe, quoted SQL value list for inline psql execution.
    columns = ", ".join(payload.keys())
    values_sql = ", ".join(_quote_sql_value(value) for value in payload.values())
    query = f"INSERT INTO public.{table_name} ({columns}) VALUES ({values_sql}) RETURNING id"

    command = [
        "docker",
        "exec",
        "-e",
        f"PGPASSWORD={config['password']}",
        container_name,
        "psql",
        "-U",
        config["user"],
        "-d",
        config["dbname"],
        "-tA",
        "-c",
        query,
    ]

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return {"stored": False, "error": result.stderr.strip() or result.stdout.strip()}

    # psql may return a command tag or the id; extract the first non-empty line
    inserted_id = next((line.strip() for line in result.stdout.splitlines() if line.strip()), "")
    if inserted_id.lower().startswith("insert "):
        inserted_id = ""
    if not inserted_id:
        return {"stored": False, "error": result.stdout.strip() or "empty_insert_result"}
    return {"stored": True, "status_code": 201, "data": [{"id": inserted_id}]}


def _post(table_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    # Prefer docker-exec insert (reliable for local Supabase Docker stacks),
    # then try a direct psycopg2 connection, then fall back to REST.
    docker_result = _docker_postgres_insert(table_name, payload)
    if docker_result.get("stored"):
        return docker_result

    postgres_result = _postgres_insert(table_name, payload)
    if postgres_result.get("stored"):
        return postgres_result

    if postgres_result.get("reason") == "psycopg2_not_installed":
        return {"stored": False, "reason": "postgres_driver_missing"}

    if not _configured():
        return {"stored": False, "reason": "supabase_not_configured"}

    req = request.Request(
        _rest_url(table_name),
        data=json.dumps(payload).encode("utf-8"),
        headers=_headers(),
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
            parsed: Optional[Any] = json.loads(body) if body else None
            return {"stored": True, "status_code": response.status, "data": parsed}
    except error.HTTPError as exc:
        return {
            "stored": False,
            "status_code": exc.code,
            "error": exc.read().decode("utf-8", errors="ignore") or exc.reason,
        }
    except Exception as exc:
        return {"stored": False, "error": str(exc)}


def _postgres_fetch_one(table_name: str, column: str, value: str) -> Optional[Dict[str, Any]]:
    if psycopg2 is None or not _postgres_configured():
        return None

    config = _get_postgres_config()
    query = f"SELECT * FROM public.{table_name} WHERE {column} = %s LIMIT 1"

    try:
        with psycopg2.connect(
            host=config["host"],
            port=config["port"],
            dbname=config["dbname"],
            user=config["user"],
            password=config["password"],
            cursor_factory=RealDictCursor,
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, (value,))
                row = cursor.fetchone()
                return dict(row) if row is not None else None
    except Exception:
        return None


def _docker_postgres_fetch_one(table_name: str, column: str, value: str) -> Optional[Dict[str, Any]]:
    if shutil.which("docker") is None:
        return None

    container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
    config = _get_postgres_config()
    query = f"SELECT row_to_json(t) FROM (SELECT * FROM public.{table_name} WHERE {column} = '{value}' LIMIT 1) t;"

    command = [
        "docker",
        "exec",
        "-e",
        f"PGPASSWORD={config['password']}",
        container_name,
        "psql",
        "-U",
        config["user"],
        "-d",
        config["dbname"],
        "-tA",
        "-c",
        query,
    ]

    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return None

    output = next((line.strip() for line in result.stdout.splitlines() if line.strip()), "")
    if not output:
        return None

    try:
        return json.loads(output)
    except Exception:
        return None


def parse_months_value(months_label: str) -> int:
    """Extract an integer month value from a label like '2 months'."""
    match = re.search(r"\d+", months_label or "")
    return int(match.group()) if match else 0


def save_patient_profile(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a patient payload and persist it to `public.patients`.

    Normalization: lower-casing and extracting numeric month value for easy
    querying in the DB. Stroke type is always set to ischemic.
    """
    normalized_payload = {
        "id": payload.get("id") or payload.get("user_id"),
        "name": payload.get("name", "").strip(),
        "stroke_type": "ischemic",
        "months_in_recovery": int(payload.get("months_in_recovery") or 0),
        "affected_area": payload.get("affected_part", "").strip().lower(),
        "affected_side": payload.get("affected_side", "").strip().lower(),
        "source_app": payload.get("source_app", "frontend"),
    }
    return _post("patients", normalized_payload)


def save_recommendation_log(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a recommendation payload to `public.recommendation_logs`."""
    return _post("recommendation_logs", payload)


def save_form_prediction(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist an LSTM form-classification result to `public.form_predictions`.

    Expected keys: patient_id, exercise_type, label, confidence,
    frame_count, device, model_source, prediction.
    Schema check constraints: confidence ∈ [0,1], frame_count >= 0,
    label ∈ {correct, incorrect, insufficient_data}.
    """
    return _post("form_predictions", payload)


def fetch_patient_history(patient_id: str, limit: int = 50) -> list:
    """Return the patient's recent recommendation_logs rows, newest first.

    Powers Phase 1 (the Gathering) of the trajectory recommender. Each row
    surfaces a flat view of the JSONB so trajectory code doesn't need to
    re-parse: exercise_id, exercise_name, ended_via, latest_form_score,
    duration_seconds, created_at.

    Tries docker-exec psql first (works in the local Supabase Docker
    stack), then direct psycopg2, then REST fallback.
    """
    query_sql = (
        "SELECT "
        "id, "
        "patient_id, "
        "latest_form_score, "
        "(recommendation->>'recommendation_id') AS exercise_id, "
        "(recommendation->>'exercise_name') AS exercise_name, "
        "(recommendation->>'ended_via') AS ended_via, "
        "COALESCE((recommendation->>'duration_seconds')::int, 0) AS duration_seconds, "
        "(recommendation->>'session_id') AS session_id, "
        "created_at "
        "FROM public.recommendation_logs "
        f"WHERE patient_id = '{patient_id}' "
        # Filter > 0 (not just NOT NULL): legacy 'started' rows from
        # before the per-action gating fix have score = 0 but are not
        # null. A real 0% session is effectively impossible because the
        # camera frame loop falls back to a random 70-95 when MediaPipe
        # returns no result.
        "AND latest_form_score > 0 "
        f"ORDER BY created_at DESC LIMIT {int(limit)}"
    )

    # Docker exec → JSON array via psql -t (one row per line, JSON each).
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_postgres_config()
        wrapped = f"SELECT json_agg(t) FROM ({query_sql}) t;"
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", wrapped,
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            # json_agg can wrap onto multiple lines when the array is
            # large; join all non-empty lines before parsing.
            output = " ".join(line.strip() for line in result.stdout.splitlines() if line.strip())
            if output and output != "null":
                try:
                    return json.loads(output) or []
                except Exception:
                    pass

    # psycopg2 fallback
    if psycopg2 is not None and _postgres_configured():
        try:
            config = _get_postgres_config()
            with psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
                cursor_factory=RealDictCursor,
            ) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query_sql)
                    return [dict(row) for row in cursor.fetchall()]
        except Exception:
            pass

    # REST fallback (limited: PostgREST can't do raw JSONB column projection)
    if _configured():
        url = (
            _rest_url("recommendation_logs")
            + f"?patient_id=eq.{patient_id}"
            "&latest_form_score=gt.0"
            "&select=id,patient_id,latest_form_score,recommendation,created_at"
            "&order=created_at.desc"
            f"&limit={int(limit)}"
        )
        req = request.Request(url, headers=_headers(), method="GET")
        try:
            with request.urlopen(req, timeout=10) as response:
                body = response.read().decode("utf-8")
                rows = json.loads(body) if body else []
                normalized = []
                for row in rows:
                    rec = row.get("recommendation") or {}
                    normalized.append({
                        "id": row.get("id"),
                        "patient_id": row.get("patient_id"),
                        "latest_form_score": row.get("latest_form_score"),
                        "exercise_id": rec.get("recommendation_id"),
                        "exercise_name": rec.get("exercise_name"),
                        "ended_via": rec.get("ended_via"),
                        "duration_seconds": int(rec.get("duration_seconds") or 0),
                        "session_id": rec.get("session_id"),
                        "created_at": row.get("created_at"),
                    })
                return normalized
        except Exception:
            pass

    return []


def get_patient_by_id(patient_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a patient record by ID from the patients table.
    
    Returns the patient dict or None if not found.
    Tries direct Postgres, then docker exec, then REST.
    """
    postgres_row = _postgres_fetch_one("patients", "id", patient_id)
    if postgres_row:
        return postgres_row

    docker_row = _docker_postgres_fetch_one("patients", "id", patient_id)
    if docker_row:
        return docker_row

    url = _rest_url("patients") + f"?id=eq.{patient_id}&select=*"
    req = request.Request(url, headers=_headers(), method="GET")

    try:
        with request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body) if body else []
            return data[0] if data else None
    except Exception:
        return None
