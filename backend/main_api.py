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


from routers import patients, pose, predictions, recommendations, sessions

app = FastAPI(title="Stroke Rehab API", version="0.1.0", lifespan=lifespan)

app.include_router(patients.router)
app.include_router(pose.router)
app.include_router(predictions.router)
app.include_router(recommendations.router)
app.include_router(sessions.router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}
