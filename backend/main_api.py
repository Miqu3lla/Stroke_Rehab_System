from dotenv import load_dotenv
load_dotenv()

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the LSTM in a background thread at startup so the first
    # end-of-exercise classification doesn't pay model-load latency (which was
    # overrunning the mobile client's request timeout). Off the main thread so
    # it never delays 'Application startup complete'.
    from core.neural_network import warmup_model
    threading.Thread(target=warmup_model, daemon=True).start()
    yield


from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from core.rate_limit import limiter
from routers import patients, pose, predictions, recommendations, sessions

app = FastAPI(title="Stroke Rehab API", version="0.1.0", lifespan=lifespan)

# Rate limiting: the limiter must live on app.state for slowapi to find it;
# the handler turns a breached limit into a 429; SlowAPIMiddleware enforces
# the limiter's default_limits on every route (per-route @limiter.limit(...)
# decorators stack tighter budgets on top).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.include_router(patients.router)
app.include_router(pose.router)
app.include_router(predictions.router)
app.include_router(recommendations.router)
app.include_router(sessions.router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}
