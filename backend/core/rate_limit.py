"""API rate limiting (slowapi).

The backend is publicly reachable through the Cloudflare tunnel, so every HTTP
endpoint is exposed to spam/abuse. slowapi enforces per-client request budgets
in-memory — no Redis needed for this single-instance deployment.

Client identity — the important part: behind the tunnel, request.client.host is
ALWAYS the tunnel's localhost address, so keying on it would drop every visitor
into one shared bucket and let a single busy client rate-limit everyone.
Cloudflare's edge sets CF-Connecting-IP to the real client IP, so we key on
that, falling back to X-Forwarded-For and finally the peer address for
direct/local calls. (The origin only listens on localhost and is reachable
only via the tunnel, so an external client can't bypass Cloudflare to spoof
these headers.)
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_ip(request: Request) -> str:
    """Best-effort real client IP for rate-limit bucketing."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # The first hop is the original client; the rest are proxies.
        return xff.split(",")[0].strip()
    return get_remote_address(request)


# default_limits apply to EVERY route via SlowAPIMiddleware (wired in
# main_api). Generous enough that normal app traffic — a handful of HTTP calls
# per session — never trips it, but low enough to stop a script hammering the
# tunnel. Expensive compute routes (LSTM / MediaPipe) add their own stricter
# @limiter.limit(...) decorators on top of this floor.
limiter = Limiter(
    key_func=client_ip,
    default_limits=["200/minute"],
    headers_enabled=True,  # emit X-RateLimit-* / Retry-After headers
)
