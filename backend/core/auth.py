"""Supabase JWT verification for FastAPI.

The Cloudflare tunnel exposes `api.necookie.dev` publicly — anyone who
finds the URL can hit our endpoints. RLS protects the DB layer, but the
API layer was wide open. This module plugs that gap.

How it works:
- Supabase issues a JWT to the mobile app at login (HS256, signed with
  the project's JWT secret available at Dashboard → Settings → API).
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
from typing import Any, Dict, Optional

import jwt  # PyJWT
from fastapi import Header, HTTPException, status


# Supabase's default JWT signing scheme is HS256 with a shared secret.
# (Newer projects can opt into asymmetric keys, in which case this would
# need to verify via JWKS instead — out of scope here.) The audience
# Supabase uses for user tokens is the string "authenticated".
_ALGORITHMS = ["HS256"]
_EXPECTED_AUDIENCE = "authenticated"


def _get_jwt_secret() -> str:
    """Return the Supabase JWT secret, or raise if it isn't configured.

    We resolve lazily (per request) rather than caching at import time so
    a redeploy that rotates the secret picks it up without a restart.
    """
    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        # 500, not 401 — this is a misconfiguration of the server, not
        # something the client did wrong.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server is missing SUPABASE_JWT_SECRET — auth cannot run.",
        )
    return secret


def verify_jwt(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """FastAPI dependency: validate the `Authorization: Bearer ...` header.

    Returns the decoded JWT claims on success. Raises 401 for any of:
      - missing header
      - wrong scheme (must be Bearer)
      - signature mismatch
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
        claims = jwt.decode(
            token,
            _get_jwt_secret(),
            algorithms=_ALGORITHMS,
            audience=_EXPECTED_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
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
