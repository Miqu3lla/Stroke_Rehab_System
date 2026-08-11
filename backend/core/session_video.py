"""Session evidence video capture (Option A).

The mobile client already streams JPEG frames to /ws/pose for realtime
pose scoring. Rather than run a second camera recording on the device
(which would fight the frame-capture loop for the front camera), we
piggyback on that stream: the WS handler feeds each incoming raw JPEG
into a SessionClipRecorder for the first ~10 seconds the patient is
visible (their first set). When that window fills, we encode the
buffered frames into a browser-playable H.264 MP4, upload it to the
private 'session-evidence' Supabase Storage bucket, write a
session_videos row, then purge the patient's clips from any earlier
session.

One clip per exercise = one clip per WS connection (the client opens one
socket per exercise). We only need proof the patient performed the
movement, so a short low-res clip is plenty. Encoding + upload happen on
a background thread so the realtime frame loop never blocks on them; if
imageio/ffmpeg isn't installed the whole thing degrades to a logged
no-op and pose scoring is unaffected.
"""
import logging
import os
import re
import tempfile
import threading
from typing import List, Optional

from core.supabase_db import (
    delete_other_session_video_rows,
    delete_storage_object,
    insert_session_video,
    list_other_session_video_paths,
    upload_to_storage,
)

logger = logging.getLogger("uvicorn.error")

# Bucket the clips live in (private; created by db/session_videos.sql).
_BUCKET = "session-evidence"

# Capture window. We only need a few seconds proving the patient did the
# movement, so we stop after whichever comes first — the time window or a
# hard frame cap that bounds the in-memory buffer.
_MAX_CLIP_SECONDS = 10.0
_MAX_CLIP_FRAMES = 200

# Output encode settings. 480p keeps clips at ~1-3 MB and is plenty for
# evidence. libx264 + yuv420p is the combination browsers (<video>)
# actually play.
_OUTPUT_MAX_HEIGHT = 480

# The clip is encoded at the REAL rate frames arrived (the pose stream is
# only ~1-3 fps over the tunnel), so playback matches real time instead
# of an 8x-fast blur. Clamp to a sane range, and fall back when there
# aren't enough frames to measure a rate.
_MIN_FPS = 1.0
_MAX_FPS = 30.0
_FALLBACK_FPS = 6.0


class SessionClipRecorder:
    """Buffers raw JPEG frames for one exercise's evidence clip.

    Feed it only frames where the patient is actually visible (the WS
    loop gates on a detected pose) so the clip doesn't open on blank
    "step back" frames. Disabled outright when the client didn't supply
    a patient_id + session_id — no evidence is captured then.
    """

    def __init__(self, patient_id: str, session_id: str, exercise_type: str) -> None:
        self.patient_id = (patient_id or "").strip()
        self.session_id = (session_id or "").strip()
        self.exercise_type = (exercise_type or "").strip()
        self.enabled = bool(self.patient_id and self.session_id)
        self._frames: List[bytes] = []
        self._start: Optional[float] = None
        self._last: Optional[float] = None
        self._done = False

    def add_frame(self, jpeg_bytes: bytes, pose_detected: bool = True) -> bool:
        """Buffer one raw JPEG frame. The clip only OPENS on the first
        frame with a detected pose (so it doesn't start on blank "step
        back" frames); once open, every frame is kept for continuity.
        Returns True the moment the capture window just closed — the
        caller should then store the clip."""
        if not self.enabled or self._done or not jpeg_bytes:
            return False
        now = _now()
        if self._start is None:
            if not pose_detected:
                return False
            self._start = now
        self._last = now
        self._frames.append(jpeg_bytes)
        elapsed = now - self._start
        if len(self._frames) >= _MAX_CLIP_FRAMES or elapsed >= _MAX_CLIP_SECONDS:
            self._done = True
            return True
        return False

    def capture_fps(self) -> float:
        """Actual rate frames arrived, so the clip encodes to real-time.
        Uses the n-1 gaps between n frames; falls back when too few
        frames to measure."""
        count = len(self._frames)
        if count <= 1 or self._start is None or self._last is None:
            return _FALLBACK_FPS
        elapsed = self._last - self._start
        if elapsed <= 0:
            return _FALLBACK_FPS
        fps = (count - 1) / elapsed
        return max(_MIN_FPS, min(_MAX_FPS, fps))

    @property
    def done(self) -> bool:
        return self._done

    def has_frames(self) -> bool:
        return bool(self._frames)

    def finalize(self) -> None:
        """Mark the window closed without adding a frame — used to flush a
        short clip when the connection drops before the window fills."""
        self._done = True

    def frames(self) -> List[bytes]:
        return self._frames


def _now() -> float:
    import time
    return time.monotonic()


def _safe_exercise_slug(exercise_type: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (exercise_type or "").lower()).strip("_")
    return slug or "exercise"


def _encode_frames_to_mp4(jpeg_frames: List[bytes], fps: float) -> Optional[bytes]:
    """Decode buffered JPEGs, downscale to <=480p, and encode a
    browser-playable H.264 MP4 at `fps` (the real capture rate, so
    playback is real-time). Returns the MP4 bytes, or None if nothing
    decodable was buffered. Imports the heavy libs lazily so importing
    this module never pulls in imageio/opencv until a clip is stored."""
    import cv2
    import numpy as np
    import imageio

    decoded = []
    out_w: Optional[int] = None
    out_h: Optional[int] = None
    for raw in jpeg_frames:
        arr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # BGR
        if img is None:
            continue
        h, w = img.shape[:2]
        if h > _OUTPUT_MAX_HEIGHT:
            scale = _OUTPUT_MAX_HEIGHT / float(h)
            img = cv2.resize(img, (max(1, int(round(w * scale))), _OUTPUT_MAX_HEIGHT))
        if out_w is None:
            oh, ow = img.shape[:2]
            # yuv420p needs even dimensions.
            out_h = oh - (oh % 2)
            out_w = ow - (ow % 2)
        # Force every frame to the first frame's size — the phone can
        # rotate/resize mid-stream and the encoder needs a constant size.
        if (img.shape[1], img.shape[0]) != (out_w, out_h):
            img = cv2.resize(img, (out_w, out_h))
        decoded.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    if not decoded:
        return None

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        writer = imageio.get_writer(
            tmp_path,
            format="FFMPEG",
            fps=fps,
            codec="libx264",
            pixelformat="yuv420p",
            macro_block_size=1,
            output_params=["-preset", "veryfast", "-crf", "28"],
        )
        try:
            for frame in decoded:
                writer.append_data(frame)
        finally:
            writer.close()
        with open(tmp_path, "rb") as handle:
            return handle.read()
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def store_clip(recorder: SessionClipRecorder) -> None:
    """Encode → upload → index → purge old sessions. Best-effort: any
    failure is logged and swallowed so evidence capture never takes down
    a pose session."""
    try:
        if not recorder.enabled or not recorder.has_frames():
            return

        fps = recorder.capture_fps()
        mp4 = _encode_frames_to_mp4(recorder.frames(), fps)
        if not mp4:
            logger.warning(
                "session-video: no encodable frames (patient=%s exercise=%s)",
                recorder.patient_id, recorder.exercise_type,
            )
            return

        slug = _safe_exercise_slug(recorder.exercise_type)
        storage_path = f"{recorder.patient_id}/{recorder.session_id}/{slug}.mp4"

        upload = upload_to_storage(_BUCKET, storage_path, mp4, "video/mp4")
        if not upload.get("stored"):
            logger.warning("session-video: upload failed: %s", upload)
            return

        duration = round(len(recorder.frames()) / fps, 1)
        indexed = insert_session_video({
            "patient_id": recorder.patient_id,
            "session_id": recorder.session_id,
            "exercise_type": recorder.exercise_type,
            "storage_path": storage_path,
            "duration_seconds": duration,
        })
        # A failed index row silently disables the retention purge (it only
        # deletes clips that have a row) -> clips stack. Log loudly instead.
        if not indexed.get("stored"):
            logger.warning("session-video: index row NOT stored (%s) - purge will "
                           "not see this clip: %s", storage_path, indexed)

        _purge_other_sessions(recorder.patient_id, recorder.session_id)
        logger.info(
            "session-video: stored %s (%d frames, %.1fs)",
            storage_path, len(recorder.frames()), duration,
        )
    except Exception:
        logger.exception("session-video: store_clip failed")


def _purge_other_sessions(patient_id: str, session_id: str) -> None:
    """Retention: keep only the current session's clips for this patient.
    Deletes the Storage objects first (so we never orphan a file whose
    row is gone), then the rows."""
    try:
        stale_paths = list_other_session_video_paths(patient_id, session_id)
        for path in stale_paths:
            delete_storage_object(_BUCKET, path)
        delete_other_session_video_rows(patient_id, session_id)
        if stale_paths:
            logger.info(
                "session-video: purged %d old clip(s) for patient=%s",
                len(stale_paths), patient_id,
            )
    except Exception:
        logger.exception("session-video: purge failed")


def store_clip_async(recorder: SessionClipRecorder) -> None:
    """Fire-and-forget the encode+upload on a daemon thread so the
    realtime WS loop never blocks on ffmpeg or network I/O."""
    threading.Thread(target=store_clip, args=(recorder,), daemon=True).start()
