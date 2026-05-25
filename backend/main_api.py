from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from routers import patients, pose, predictions, recommendations, sessions

app = FastAPI(title="Stroke Rehab API", version="0.1.0")

app.include_router(patients.router)
app.include_router(pose.router)
app.include_router(predictions.router)
app.include_router(recommendations.router)
app.include_router(sessions.router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}
