"""Supabase JWT verification for FastAPI.

The Cloudflare tunnel exposes `api.necookie.dev` publicly — anyone who
finds the URL can hit our endpoints. RLS protects the DB layer, but the
API layer was wide open. This module plugs that gap.

How it works:
- Supabase issues a JWT to the mobile app at login. The cloud project
  signs user tokens asymmetrically (ES256): Supabase publishes the public
  half at a JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  and we verify each token against whichever key matches its `kid` header
  — there is no shared secret to configure. (A self-hosted/legacy project
  using HS256 + a shared secret would need this reverted; see git history.)
- The frontend's axios interceptor attaches `Authorization: Bearer <jwt>`
  on every backend request.
- Each protected router declares `Depends(verify_jwt)` (or the alias
  `Depends(require_patient)`) which validates the token and returns the
  decoded claims dict. The user id lives at `claims["sub"]`.

Endpoints that take a `patient_id` (in the URL or body) should call
`assert_patient_match(claims, patient_id)` to enforce that the token's
owner matches the resource being acted on — without that check, a
logged-in patient could still pass someone else's id in the request.

Only `/health` should remain unauthenticated.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, Optional

import jwt  # PyJWT
from fastapi import Header, HTTPException, status
from jwt import PyJWK, PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError


_ALGORITHMS = ["ES256"]
_EXPECTED_AUDIENCE = "authenticated"


class AuthConfigError(Exception):
    """The SERVER is misconfigured for JWT verification (e.g. SUPABASE_URL
    unset) — distinct from a bad/expired/unverifiable TOKEN. Callers map
    this to a 500-equivalent (verify_jwt: HTTP 500; routers/pose.py's WS
    handshake: a 1011 server-error close) instead of folding it into the
    same 401-equivalent every rejected-token case uses — the same 500-vs-401
    split the old HS256 _get_jwt_secret() comment made on purpose.
    """


# Floor between forced JWKS refetches (see _ThrottledPyJWKClient below).
_MIN_FORCED_REFRESH_INTERVAL_SECONDS = 5.0


class _ThrottledPyJWKClient(PyJWKClient):
    """PyJWKClient.get_signing_key() forces an unconditional JWKS refetch
    (bypassing `lifespan`'s 5-minute cache) whenever a token's kid isn't in
    the cached set - by design, so a real key rotation is picked up right
    away instead of waiting out the cache TTL. But nothing else rate-limits
    that path: every request carrying a *fabricated* kid also forces a real
    network round trip to Supabase, so an attacker spamming random kids at
    verify_jwt's own 200/minute limit turns into 200/minute of upstream
    JWKS requests. This floors the gap between forced refreshes so a burst
    of bad kids collapses onto one real refetch; genuine rotation is still
    picked up, just at worst _MIN_FORCED_REFRESH_INTERVAL_SECONDS later.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._last_forced_refresh = 0.0
        self._refresh_lock = threading.Lock()

    def get_signing_key(self, kid: str) -> PyJWK:
        signing_keys = self.get_signing_keys()
        signing_key = self.match_kid(signing_keys, kid)
        if signing_key:
            return signing_key

        with self._refresh_lock:
            # Re-check the CACHED keys first (no network call) - another
            # thread may have already refreshed while we waited for the
            # lock. Without this, the throttle below would make us give up
            # on a kid that a sibling request just made valid.
            signing_keys = self.get_signing_keys()
            signing_key = self.match_kid(signing_keys, kid)
            if not signing_key:
                now = time.monotonic()
                if now - self._last_forced_refresh >= _MIN_FORCED_REFRESH_INTERVAL_SECONDS:
                    signing_keys = self.get_signing_keys(refresh=True)
                    signing_key = self.match_kid(signing_keys, kid)
                    self._last_forced_refresh = now

        if not signing_key:
            raise PyJWKClientError(f'Unable to find a signing key that matches: "{kid}"')
        return signing_key


# Cached PyJWKClient — it fetches + caches the JWKS document itself (5 min
# default TTL), so we only need to rebuild it if SUPABASE_URL changes (e.g.
# a redeploy pointed at a different project) or on first use. Module-level
# rather than per-request: refetching the whole JWKS on every request would
# be a needless round trip to Supabase on the hot path.
_jwks_client: Optional[_ThrottledPyJWKClient] = None
_jwks_client_url: Optional[str] = None


def _get_jwks_client() -> _ThrottledPyJWKClient:
    base_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not base_url:
        # AuthConfigError, not HTTPException: this function is shared by an
        # HTTP dependency (verify_jwt) AND a WebSocket handshake
        # (routers/pose.py), and HTTPException has no meaning on the WS
        # side. Kept distinct from PyJWKClientError/InvalidTokenError too,
        # on purpose — this is OUR misconfiguration, not a bad token, and
        # must map to 500 / a server-error close, never a 401 / "invalid
        # token" close the client could mistake for their own mistake.
        raise AuthConfigError("Server is missing SUPABASE_URL - auth cannot run.")
    jwks_url = f"{base_url}/auth/v1/.well-known/jwks.json"
    global _jwks_client, _jwks_client_url
    if _jwks_client is None or _jwks_client_url != jwks_url:
        _jwks_client = _ThrottledPyJWKClient(jwks_url)
        _jwks_client_url = jwks_url
    return _jwks_client


def decode_supabase_jwt(token: str) -> Dict[str, Any]:
    """Verify a Supabase-issued JWT via the project's JWKS and return its
    claims.

    Raises on failure:
      - AuthConfigError if the SERVER is misconfigured (e.g. SUPABASE_URL
        unset) — a 500 / server-error case, not the token's fault.
      - jwt.* / PyJWKClientError for anything wrong with the TOKEN itself
        (expired, bad signature, unknown kid, wrong audience, ...).
    Callers decide how to surface each: verify_jwt below maps AuthConfigError
    to HTTP 500 and everything else to 401; routers/pose.py's WS handshake
    maps AuthConfigError to a 1011 server-error close and everything else to
    a 4401 unauthorized close. Shared by both call sites so there is exactly
    one JWKS cache/fetch path in the process, not two independently-drifting
    copies.
    """
    signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=_ALGORITHMS,
        audience=_EXPECTED_AUDIENCE,
        options={"require": ["exp", "sub"]},
    )


def verify_jwt(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """FastAPI dependency: validate the `Authorization: Bearer ...` header.

    Returns the decoded JWT claims on success. Raises 401 for any of:
      - missing header
      - wrong scheme (must be Bearer)
      - signature mismatch / unknown signing key
      - expired token
      - wrong audience
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = decode_supabase_jwt(token)
    except AuthConfigError as exc:
        # 500, not 401 — this is a misconfiguration of the server, not
        # something the client did wrong (mirrors the old _get_jwt_secret
        # comment this replaces).
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidAudienceError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token audience mismatch",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except PyJWKClientConnectionError as exc:
        # We couldn't even reach the JWKS endpoint (network/DNS/Supabase
        # outage) — that's not evidence the TOKEN is bad, so it shouldn't
        # be a 401 (which would look like a bad-login prompt to the
        # client). Caught before PyJWKClientError below since this is a
        # subclass of it.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unable to reach JWKS endpoint: {exc}",
        ) from exc
    except PyJWKClientError as exc:
        # No key matches the token's kid — not the same as a bad
        # signature, but we still can't verify the token, so it's still a
        # 401 (kept distinguishable from InvalidTokenError below for
        # anyone reading server logs).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unable to verify token signature: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        # Catch-all for malformed / bad-signature / missing-claim tokens.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return claims


def assert_patient_match(claims: Dict[str, Any], patient_id: str) -> None:
    """Raise 403 if the token's subject doesn't match the patient_id.

    Use this in handlers that take a patient_id in the URL or body —
    without it, an authenticated user could still pass somebody else's
    id and (subject to RLS) potentially read/write the wrong rows.
    """
    token_sub = (claims.get("sub") or "").strip().lower()
    target = (patient_id or "").strip().lower()
    if not token_sub or not target or token_sub != target:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token does not match the requested patient_id",
        )
