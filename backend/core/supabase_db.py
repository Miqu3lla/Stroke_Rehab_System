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
from urllib import error, parse, request

# UUID format used by patient_id and other primary keys — validated at
# every external entry point so we never splice unsanitised text into a
# SQL string or URL filter.
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

# Strict identifier pattern for any SQL piece we have to interpolate
# (table names, column names) because psycopg2 / psql can't bind those
# as parameters.
_SAFE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Client-generated session correlation key. Not a DB uuid, so it gets its
# own gate before it can be spliced into the docker-exec psql path.
_SAFE_SESSION_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

# session_videos.exercise_type is client-supplied free text (the WS auth
# message's exercise_type/exercise_slug, not guaranteed to be a clean slug —
# see routers/pose.py), so it gets a permissive-but-bounded gate rather than
# _SAFE_IDENT_RE. session_videos.storage_path is built server-side as
# "{patient_id}/{session_id}/{slug}.mp4" but is re-validated here too, since
# _quote_sql_value's escaping is not a substitute for the format gate every
# other spliced value in this module goes through first.
_SAFE_EXERCISE_RE = re.compile(r"^[A-Za-z0-9 _-]{1,64}$")
_SAFE_STORAGE_PATH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,512}$")

# The Cloudflare tunnel in front of Supabase blocks requests whose
# User-Agent looks non-browser (403 / CF error 1010). Every request we
# send through the tunnel must carry a browser-like UA — REST calls and
# Storage uploads alike.
_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
)


def _is_valid_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.match(value))

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
        "User-Agent": _BROWSER_USER_AGENT,
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

    # table_name / column are interpolated into the SQL string (psycopg2
    # can't bind identifiers, only values). Gate both with a strict
    # identifier regex so callers can't pass crafted column names.
    if not _SAFE_IDENT_RE.match(table_name) or not _SAFE_IDENT_RE.match(column):
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

    # psql via subprocess can't bind parameters, so we gate every piece
    # spliced into the SQL. Table and column names must match a strict
    # identifier regex; the value (always a UUID in callers today) must
    # match _UUID_RE. Reject anything else outright.
    if not _SAFE_IDENT_RE.match(table_name) or not _SAFE_IDENT_RE.match(column):
        return None
    if not _is_valid_uuid(value):
        return None

    container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
    config = _get_postgres_config()
    query = f"SELECT row_to_json(t) FROM (SELECT * FROM public.{table_name} WHERE {column} = '{value}' LIMIT 1) t;"

    command = [
        "docker", "exec",
        "-e", f"PGPASSWORD={config['password']}",
        container_name,
        "psql", "-U", config["user"], "-d", config["dbname"],
        "-tA", "-c", query,
    ]

    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=8)
    except subprocess.TimeoutExpired:
        return None
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
        "first_name": payload.get("first_name", "").strip(),
        "last_name": payload.get("last_name", "").strip(),
        "stroke_type": "ischemic",
        "months_in_recovery": int(payload.get("months_in_recovery") or 0),
        "affected_area": payload.get("affected_area", "").strip().lower(),
        "affected_side": payload.get("affected_side", "").strip().lower(),
        "source_app": payload.get("source_app", "frontend"),
    }
    return _post("patients", normalized_payload)


def save_recommendation_log(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a recommendation payload to `public.recommendation_logs`."""
    return _post("recommendation_logs", payload)


def recommendation_log_exists(patient_id: str, session_id: str, session_index: int) -> bool:
    """Return True if a recommendation_logs row already exists for this
    (patient_id, session_id, session_index) tuple — the natural key of a
    per-exercise result inside a session.

    Used by /sessions to short-circuit duplicate insertions when a mobile
    client retries the batch POST. session_id and session_index live inside
    the JSONB column today, so the existence check inspects those keys
    rather than dedicated columns. Promote to columns + unique index in a
    later migration if scale demands it.
    """
    if not _is_valid_uuid(patient_id) or not session_id:
        return False

    # docker exec path
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_postgres_config()
        # session_id is also a UUID, session_index is an int — both are
        # validated via psql escaping below.
        sql = (
            "SELECT 1 FROM public.recommendation_logs "
            f"WHERE patient_id = '{patient_id}' "
            f"AND (recommendation->>'session_id') = '{session_id}' "
            f"AND COALESCE((recommendation->>'session_index')::int, -1) = {int(session_index)} "
            "LIMIT 1"
        )
        if not (_is_valid_uuid(session_id)):
            return False
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", sql,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=5)
            if result.returncode == 0 and result.stdout.strip():
                return True
        except subprocess.TimeoutExpired:
            return False

    # psycopg2 (parameterised)
    if psycopg2 is not None and _postgres_configured():
        try:
            config = _get_postgres_config()
            sql = (
                "SELECT 1 FROM public.recommendation_logs "
                "WHERE patient_id = %s "
                "AND (recommendation->>'session_id') = %s "
                "AND COALESCE((recommendation->>'session_index')::int, -1) = %s "
                "LIMIT 1"
            )
            with psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
            ) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(sql, (patient_id, session_id, int(session_index)))
                    return cursor.fetchone() is not None
        except Exception:
            pass

    return False


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
    # Hard gate: patient_id must be a real UUID. Stops SQL/URL injection
    # at the door regardless of which backend (psql via docker exec,
    # psycopg2, or REST) we end up using below.
    if not _is_valid_uuid(patient_id):
        return []

    safe_limit = max(1, min(int(limit or 50), 500))

    # The SELECT clause is fully static; only patient_id and LIMIT vary.
    # psql via subprocess can't bind parameters, but the UUID gate above
    # already guarantees patient_id contains only [0-9a-fA-F-].
    select_clause = (
        "SELECT "
        "id, "
        "patient_id, "
        "latest_form_score, "
        # COALESCE to '' so legacy rows (created before exercise_type
        # existed) match the REST path's normalization below — otherwise
        # docker/psycopg2 return None while REST returns "", and the
        # recommender's history lookup sees inconsistent shapes.
        "COALESCE(exercise_type, '') AS exercise_type, "
        "(recommendation->>'recommendation_id') AS exercise_id, "
        "(recommendation->>'exercise_name') AS exercise_name, "
        "(recommendation->>'ended_via') AS ended_via, "
        "COALESCE((recommendation->>'duration_seconds')::int, 0) AS duration_seconds, "
        # Strength load logged this session. -1 sentinel = no weight logged
        # (Functionality/legacy rows) so the recommender can tell "unloaded
        # 0 kg" apart from "not a Strength session".
        "COALESCE((recommendation->>'weight_kg')::float, -1) AS weight_kg, "
        "(recommendation->>'session_id') AS session_id, "
        "created_at "
        "FROM public.recommendation_logs "
        # Filter > 0 (not just NOT NULL) so legacy pre-gating-fix rows
        # (score=0 but NOT NULL) are excluded from trajectory analysis.
        "WHERE patient_id = '{pid}' AND latest_form_score > 0 "
        "ORDER BY created_at DESC LIMIT {lim}"
    )
    docker_query_sql = select_clause.format(pid=patient_id, lim=safe_limit)

    # Docker exec → JSON array via psql -t (one row per line, JSON each).
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_postgres_config()
        wrapped = f"SELECT json_agg(t) FROM ({docker_query_sql}) t;"
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", wrapped,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=8)
        except subprocess.TimeoutExpired:
            result = None
        if result is not None and result.returncode == 0:
            output = " ".join(line.strip() for line in result.stdout.splitlines() if line.strip())
            if output and output != "null":
                try:
                    return json.loads(output) or []
                except Exception:
                    pass

    # psycopg2 fallback — parameterised, so no injection surface here.
    if psycopg2 is not None and _postgres_configured():
        try:
            config = _get_postgres_config()
            parameterised_sql = (
                "SELECT "
                "id, patient_id, latest_form_score, "
                "COALESCE(exercise_type, '') AS exercise_type, "
                "(recommendation->>'recommendation_id') AS exercise_id, "
                "(recommendation->>'exercise_name') AS exercise_name, "
                "(recommendation->>'ended_via') AS ended_via, "
                "COALESCE((recommendation->>'duration_seconds')::int, 0) AS duration_seconds, "
                "COALESCE((recommendation->>'weight_kg')::float, -1) AS weight_kg, "
                "(recommendation->>'session_id') AS session_id, "
                "created_at "
                "FROM public.recommendation_logs "
                "WHERE patient_id = %s AND latest_form_score > 0 "
                "ORDER BY created_at DESC LIMIT %s"
            )
            with psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
                cursor_factory=RealDictCursor,
            ) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(parameterised_sql, (patient_id, safe_limit))
                    return [dict(row) for row in cursor.fetchall()]
        except Exception:
            pass

    # REST fallback (limited: PostgREST can't do raw JSONB column projection)
    if _configured():
        url = (
            _rest_url("recommendation_logs")
            + f"?patient_id=eq.{parse.quote(patient_id, safe='')}"
            "&latest_form_score=gt.0"
            "&select=id,patient_id,latest_form_score,exercise_type,recommendation,created_at"
            "&order=created_at.desc"
            f"&limit={safe_limit}"
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
                        "exercise_type": row.get("exercise_type") or "",
                        "exercise_id": rec.get("recommendation_id"),
                        "exercise_name": rec.get("exercise_name"),
                        "ended_via": rec.get("ended_via"),
                        "duration_seconds": int(rec.get("duration_seconds") or 0),
                        # None here (not -1) — the SQL paths use -1 as their
                        # "no weight" sentinel; the REST path passes the raw
                        # value through and trajectory treats None as unlogged.
                        "weight_kg": rec.get("weight_kg"),
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


# ── Session evidence video (Storage + session_videos table) ─────────────
# Backing the Option-A clip capture in core/session_video.py. Uploads go
# to the Supabase Storage REST API (separate from PostgREST); the index
# rows use the same docker/psycopg2/REST fallback chain as everything
# else in this module.


def _storage_base_url() -> str:
    return f"{_get_supabase_url().rstrip('/')}/storage/v1"


def upload_to_storage(bucket: str, path: str, data: bytes, content_type: str) -> Dict[str, Any]:
    """Upload bytes to a Supabase Storage bucket (service role, upsert).

    Requires SUPABASE_URL + service key. `x-upsert` overwrites an existing
    object at the same path so re-running an exercise replaces its clip
    rather than erroring.
    """
    if not _configured():
        return {"stored": False, "reason": "supabase_not_configured"}

    key = _get_service_role_key()
    url = f"{_storage_base_url()}/object/{bucket}/{parse.quote(path, safe='/')}"
    headers = {
        "User-Agent": _BROWSER_USER_AGENT,
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    req = request.Request(url, data=data, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=30) as response:
            return {"stored": True, "status_code": response.status}
    except error.HTTPError as exc:
        return {
            "stored": False,
            "status_code": exc.code,
            "error": exc.read().decode("utf-8", errors="ignore") or exc.reason,
        }
    except Exception as exc:
        return {"stored": False, "error": str(exc)}


def delete_storage_object(bucket: str, path: str) -> bool:
    """Delete one object from a Storage bucket. Returns True on success."""
    if not _configured():
        return False
    key = _get_service_role_key()
    url = f"{_storage_base_url()}/object/{bucket}/{parse.quote(path, safe='/')}"
    headers = {
        "User-Agent": _BROWSER_USER_AGENT,
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    req = request.Request(url, headers=headers, method="DELETE")
    try:
        with request.urlopen(req, timeout=15) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def session_video_row_exists_for_path(storage_path: str) -> Optional[bool]:
    """Whether ANY session_videos row currently references this storage_path.

    storage_path is a deterministic key ("{patient_id}/{session_id}/
    {exercise_type}.mp4"), not a per-upload-unique one — the Storage object
    is uploaded with x-upsert precisely so a re-record (e.g. a WS reconnect
    for the same exercise) overwrites the SAME file. That means an EARLIER,
    already-committed row can still legitimately point at a path a LATER
    call is failing to index. Callers use this before deleting a Storage
    object on an index failure, so returning the wrong answer either way is
    unsafe: True/False must be a real, confirmed answer, and None (every
    backend tier failed) must be treated as "unknown, do NOT delete" — never
    coerced to False.
    """
    if not _SAFE_STORAGE_PATH_RE.match(storage_path or ""):
        return None

    # psycopg2 (parameterised) — preferred, no injection surface.
    if psycopg2 is not None and _postgres_configured():
        conn = None
        try:
            config = _get_postgres_config()
            conn = psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
            )
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT EXISTS(SELECT 1 FROM public.session_videos WHERE storage_path = %s)",
                    (storage_path,),
                )
                row = cursor.fetchone()
                return bool(row[0]) if row is not None else None
        except Exception:
            pass  # fall through to docker/REST
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # docker exec — storage_path is gated above; password and SQL text stay
    # out of argv the same way insert_session_video's docker tier does.
    if shutil.which("docker") is not None:
        try:
            container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
            config = _get_postgres_config()
            sql = (
                "SELECT EXISTS(SELECT 1 FROM public.session_videos WHERE storage_path = "
                f"{_quote_sql_value(storage_path)})"
            )
            command = [
                "docker", "exec", "-i", "-e", "PGPASSWORD",
                container_name, "psql", "-U", config["user"], "-d", config["dbname"],
                "-tA", "-f", "-",
            ]
            result = subprocess.run(
                command, input=sql, capture_output=True, text=True, check=False,
                timeout=8, env={**os.environ, "PGPASSWORD": config["password"]},
            )
            if result.returncode == 0:
                # psql -tA prints a bare "t" or "f" for a boolean SELECT.
                return result.stdout.strip().lower().startswith("t")
        except Exception:
            pass  # fall through to REST

    # REST fallback — PostgREST filter, existence via a 1-row select.
    if _configured():
        try:
            url = (_rest_url("session_videos")
                   + f"?storage_path=eq.{parse.quote(storage_path, safe='')}&select=id&limit=1")
            req = request.Request(url, headers=_headers(), method="GET")
            with request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read())
                return len(data) > 0
        except Exception:
            pass

    return None  # every tier failed — undeterminable, caller must not delete


def insert_session_video(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert one evidence-clip index row into `public.session_videos`.

    Expected keys: patient_id, session_id, exercise_type, storage_path,
    duration_seconds.

    UPSERT on (patient_id, session_id, exercise_type): the Storage object
    is uploaded with x-upsert (same path overwrites), so re-recording the
    same exercise in a session — e.g. a WS reconnect — must UPDATE the
    existing row rather than leave a duplicate pointing at the same file
    with a stale duration/created_at. Requires the unique index from
    db/session_videos.sql.
    """
    patient_id = payload.get("patient_id")
    session_id = payload.get("session_id")
    exercise_type = payload.get("exercise_type") or ""
    storage_path = payload.get("storage_path") or ""
    try:
        duration_seconds = float(payload.get("duration_seconds") or 0)
    except (ValueError, TypeError):
        duration_seconds = 0.0

    if not _is_valid_uuid(patient_id) or not _SAFE_SESSION_RE.match(session_id or ""):
        return {"stored": False, "reason": "invalid_ids"}
    if not _SAFE_EXERCISE_RE.match(exercise_type) or not _SAFE_STORAGE_PATH_RE.match(storage_path):
        return {"stored": False, "reason": "invalid_exercise_or_path"}

    values = (patient_id, session_id, exercise_type, storage_path, duration_seconds)

    # Tiers are tried in order and FALL THROUGH on failure (matching
    # list_/delete_other_session_video_*): locally, host :5432 is the pooler,
    # so the direct psycopg2 connect can fail auth while the docker-exec socket
    # tier and the REST tier still work. Returning on the first tier's failure
    # (the old bug) left session_videos empty, which silently disabled the
    # retention purge. last_error is surfaced only if every tier fails.
    last_error: Optional[str] = None

    # psycopg2 (parameterised) — preferred, no injection surface.
    if psycopg2 is not None and _postgres_configured():
        conn = None
        try:
            config = _get_postgres_config()
            conn = psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
            )
            with conn.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO public.session_videos "
                    "(patient_id, session_id, exercise_type, storage_path, duration_seconds) "
                    "VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (patient_id, session_id, exercise_type) DO UPDATE SET "
                    "storage_path = EXCLUDED.storage_path, "
                    "duration_seconds = EXCLUDED.duration_seconds, "
                    "created_at = now()",
                    values,
                )
                conn.commit()
                return {"stored": True, "status_code": 201}
        except Exception as exc:
            last_error = str(exc)  # fall through to docker/REST
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # docker exec — patient_id/session_id/exercise_type/storage_path are all
    # gated above, and _quote_sql_value escapes them too. The password and
    # SQL text are still kept OUT of argv (see command/env below): a process
    # listing or audit log on the same host must not be able to read them.
    if shutil.which("docker") is not None:
        try:
            container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
            config = _get_postgres_config()
            cols = "(patient_id, session_id, exercise_type, storage_path, duration_seconds)"
            vals_sql = ", ".join(_quote_sql_value(v) for v in values)
            sql = (
                f"INSERT INTO public.session_videos {cols} VALUES ({vals_sql}) "
                "ON CONFLICT (patient_id, session_id, exercise_type) DO UPDATE SET "
                "storage_path = EXCLUDED.storage_path, "
                "duration_seconds = EXCLUDED.duration_seconds, "
                "created_at = now()"
            )
            command = [
                "docker", "exec", "-i",
                # "-e PGPASSWORD" with NO "=value" tells docker to forward the
                # CURRENT value from this subprocess's own env (set below),
                # instead of putting the password in argv.
                "-e", "PGPASSWORD",
                container_name, "psql", "-U", config["user"], "-d", config["dbname"],
                # ON_ERROR_STOP=1: without it a failing INSERT can still exit 0,
                # which we'd wrongly read below as "stored".
                "-v", "ON_ERROR_STOP=1", "-tA",
                # Script comes over stdin ("-f -"), not "-c <sql>" in argv —
                # argv would otherwise leak patient_id/session_id/storage_path
                # to any same-user process listing or audit log.
                "-f", "-",
            ]
            result = subprocess.run(
                command, input=sql, capture_output=True, text=True, check=False,
                timeout=8, env={**os.environ, "PGPASSWORD": config["password"]},
            )
            if result.returncode == 0:
                return {"stored": True, "status_code": 201}
            last_error = result.stderr.strip() or result.stdout.strip()  # fall through to REST
        except subprocess.TimeoutExpired:
            last_error = "docker_timeout"
        except Exception as exc:
            # Config lookup, SQL construction, or docker launch (OSError) failed
            # before we could even run psql — fall through to REST either way.
            last_error = str(exc)

    # REST fallback — PostgREST upsert via merge-duplicates on the unique key.
    if _configured():
        headers = dict(_headers())
        headers["Prefer"] = "resolution=merge-duplicates"
        url = _rest_url("session_videos") + "?on_conflict=patient_id,session_id,exercise_type"
        body = json.dumps({
            "patient_id": patient_id,
            "session_id": session_id,
            "exercise_type": exercise_type,
            "storage_path": storage_path,
            "duration_seconds": duration_seconds,
        }).encode("utf-8")
        req = request.Request(url, data=body, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=10) as response:
                return {"stored": True, "status_code": response.status}
        except Exception as exc:
            last_error = str(exc)

    return {"stored": False, "error": last_error or "no_backend_available"}


def list_other_session_video_paths(patient_id: str, session_id: str) -> list:
    """storage_path values for this patient's clips from OTHER sessions —
    i.e. the ones the retention purge should delete. Empty on any gate
    failure so a bad id can never widen the delete set."""
    if not _is_valid_uuid(patient_id) or not _SAFE_SESSION_RE.match(session_id or ""):
        return []

    # psycopg2 (parameterised) — preferred, no injection surface.
    # `with psycopg2.connect(...)` manages the transaction but does NOT
    # close the connection, so close it explicitly to avoid leaking one
    # per purge.
    if psycopg2 is not None and _postgres_configured():
        conn = None
        try:
            config = _get_postgres_config()
            conn = psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
            )
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT storage_path FROM public.session_videos "
                    "WHERE patient_id = %s AND session_id <> %s",
                    (patient_id, session_id),
                )
                return [row[0] for row in cursor.fetchall() if row and row[0]]
        except Exception:
            pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # docker exec — both values are gated above, safe to splice.
    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_postgres_config()
        sql = (
            "SELECT string_agg(storage_path, E'\\n') FROM public.session_videos "
            f"WHERE patient_id = '{patient_id}' AND session_id <> '{session_id}'"
        )
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", sql,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=8)
            if result.returncode == 0:
                output = result.stdout.strip()
                if output:
                    return [line.strip() for line in output.splitlines() if line.strip()]
        except subprocess.TimeoutExpired:
            pass

    # REST fallback.
    if _configured():
        url = (
            _rest_url("session_videos")
            + f"?patient_id=eq.{parse.quote(patient_id, safe='')}"
            + f"&session_id=neq.{parse.quote(session_id, safe='')}"
            + "&select=storage_path"
        )
        req = request.Request(url, headers=_headers(), method="GET")
        try:
            with request.urlopen(req, timeout=10) as response:
                body = response.read().decode("utf-8")
                rows = json.loads(body) if body else []
                return [r.get("storage_path") for r in rows if r.get("storage_path")]
        except Exception:
            pass

    return []


def delete_other_session_video_rows(patient_id: str, session_id: str) -> None:
    """Delete this patient's session_videos rows from OTHER sessions."""
    if not _is_valid_uuid(patient_id) or not _SAFE_SESSION_RE.match(session_id or ""):
        return

    # `with psycopg2.connect(...)` commits/rolls back but does not close
    # the socket — close it explicitly so the purge doesn't leak a
    # connection each time.
    if psycopg2 is not None and _postgres_configured():
        conn = None
        try:
            config = _get_postgres_config()
            conn = psycopg2.connect(
                host=config["host"], port=config["port"], dbname=config["dbname"],
                user=config["user"], password=config["password"],
            )
            with conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM public.session_videos "
                    "WHERE patient_id = %s AND session_id <> %s",
                    (patient_id, session_id),
                )
                conn.commit()
                return
        except Exception:
            pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    if shutil.which("docker") is not None:
        container_name = os.getenv("SUPABASE_DOCKER_CONTAINER", "supabase-db")
        config = _get_postgres_config()
        sql = (
            "DELETE FROM public.session_videos "
            f"WHERE patient_id = '{patient_id}' AND session_id <> '{session_id}'"
        )
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={config['password']}",
            container_name, "psql", "-U", config["user"], "-d", config["dbname"],
            "-tA", "-c", sql,
        ]
        try:
            subprocess.run(command, capture_output=True, text=True, check=False, timeout=8)
            return
        except subprocess.TimeoutExpired:
            pass

    if _configured():
        url = (
            _rest_url("session_videos")
            + f"?patient_id=eq.{parse.quote(patient_id, safe='')}"
            + f"&session_id=neq.{parse.quote(session_id, safe='')}"
        )
        req = request.Request(url, headers=_headers(), method="DELETE")
        try:
            with request.urlopen(req, timeout=10):
                return
        except Exception:
            pass
