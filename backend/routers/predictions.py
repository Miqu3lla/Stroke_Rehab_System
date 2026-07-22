import logging
import tempfile
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile

from core.auth import assert_patient_match, verify_jwt
from core.mediapipe_vision import extract_sequence_from_video
from core.neural_network import classify_form_sequence
from core.exercise_catalog import is_lstm_supported
from core.rate_limit import limiter
from core.supabase_db import save_form_prediction
from schemas.prediction import FormRequest

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/predict/form")
@limiter.limit("30/minute")  # LSTM inference — one call per finished exercise in normal use
def predict_form(request: Request, response: Response, payload: FormRequest, claims: Dict[str, Any] = Depends(verify_jwt)) -> dict:
    assert_patient_match(claims, payload.patient_id)
    # For exercise_types the LSTM was never trained on, skip and return a
    # 'skipped' marker rather than polluting form_predictions with
    # out-of-distribution guesses.
    if not is_lstm_supported(payload.exercise_type):
        return {
            "patient_id": payload.patient_id,
            "exercise_type": payload.exercise_type,
            "prediction": None,
            "skipped": True,
            "reason": "exercise_type_not_in_lstm_training_set",
        }

    sequence_dicts = [
        {"frame_index": frame.frame_index, "keypoints": frame.keypoints}
        for frame in payload.sequence
    ]
    prediction = classify_form_sequence(payload.exercise_type, sequence_dicts)

    db_result = {"stored": False, "reason": "not_attempted"}
    try:
        confidence = float(prediction.get("confidence") or 0.0)
        confidence = max(0.0, min(1.0, confidence))
        db_result = save_form_prediction({
            "patient_id": payload.patient_id,
            "exercise_type": payload.exercise_type,
            "label": prediction.get("label") or "insufficient_data",
            "confidence": confidence,
            "frame_count": int(prediction.get("frame_count") or 0),
            "device": prediction.get("device") or "",
            "model_source": prediction.get("model_source") or "",
            "prediction": prediction,
        })
    except Exception as exc:
        logger.exception("Failed to persist form_prediction: %s", exc)
        db_result = {"stored": False, "error": str(exc)}

    return {
        "patient_id": payload.patient_id,
        "exercise_type": payload.exercise_type,
        "prediction": prediction,
        "database": db_result,
    }


@router.post("/predict/form-from-video")
@limiter.limit("10/minute")  # heavy: full-video MediaPipe extraction + LSTM
async def predict_form_from_video(
    request: Request,
    response: Response,
    patient_id: str = Form(...),
    exercise_type: str = Form(...),
    video: UploadFile = File(...),
    claims: Dict[str, Any] = Depends(verify_jwt),
) -> Dict[str, Any]:
    assert_patient_match(claims, patient_id)
    suffix = Path(video.filename or "session.mp4").suffix or ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await video.read())
        temp_path = Path(temp.name)

    try:
        sequence_data = extract_sequence_from_video(str(temp_path), sample_every_n=2)
        if is_lstm_supported(exercise_type):
            prediction = classify_form_sequence(exercise_type, sequence_data["sequence"])
        else:
            prediction = None
    except (ValueError, FileNotFoundError) as exc:
        # Known client/validation errors: bad video format, unreadable file, etc.
        raise HTTPException(status_code=400, detail=f"Video processing failed: {exc}") from exc
    except Exception as exc:
        # Unexpected server-side failure — log full traceback internally and
        # return a generic 500 so the client isn't misled by a 400.
        logger.exception("Unexpected error during video form prediction: %s", exc)
        raise HTTPException(status_code=500, detail="Video processing failed due to an internal server error.") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    db_result = {"stored": False, "reason": "skipped"}
    if prediction is not None:
        try:
            confidence = float(prediction.get("confidence") or 0.0)
            confidence = max(0.0, min(1.0, confidence))
            db_result = save_form_prediction({
                "patient_id": patient_id,
                "exercise_type": exercise_type,
                "label": prediction.get("label") or "insufficient_data",
                "confidence": confidence,
                "frame_count": int(prediction.get("frame_count") or 0),
                "device": prediction.get("device") or "",
                "model_source": prediction.get("model_source") or "",
                "prediction": prediction,
            })
        except Exception as exc:
            logger.exception("Failed to persist form_prediction (video): %s", exc)
            db_result = {"stored": False, "error": str(exc)}

    return {
        "patient_id": patient_id,
        "exercise_type": exercise_type,
        "prediction": prediction,
        "skipped": prediction is None,
        "database": db_result,
        "video_meta": {
            "num_frames": sequence_data["num_frames"],
            "fps": sequence_data["fps"],
            "width": sequence_data["width"],
            "height": sequence_data["height"],
        },
    }
