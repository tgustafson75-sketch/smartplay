"""
FastAPI entry point.

POST /api/cage/check-bullseye   — single still-frame validity check
POST /api/cage/analyze          — full video pipeline (multipart upload)
GET  /health                    — liveness probe for the container
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .bullseye import detect_bullseye
from .pipeline import analyze_video

# ─── Logging ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("cage-analysis")

app = FastAPI(title="SmartPlay Cage Analysis", version="1.0.0")


# ─── Health ───────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "cage-analysis", "version": "1.0.0"}


# ─── /api/cage/check-bullseye ─────────────────────────────────────────

class CheckBullseyeRequest(BaseModel):
    image: str  # base64-encoded JPEG/PNG


@app.post("/api/cage/check-bullseye")
async def check_bullseye(req: CheckBullseyeRequest) -> dict:
    log.info("[check-bullseye] request received")

    if not req.image:
        raise HTTPException(status_code=400, detail="image is required")

    # Strip an optional data URL prefix
    payload = req.image
    if "," in payload and payload.startswith("data:"):
        payload = payload.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(payload)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="could not decode image")

    result = detect_bullseye(frame)
    response = {
        "detected": result.detected,
        "location": list(result.location) if result.location else None,
        "canvas_visible": result.canvas_visible,
    }
    log.info("[check-bullseye] response=%s", response)
    return response


# ─── /api/cage/analyze ────────────────────────────────────────────────

@app.post("/api/cage/analyze")
async def analyze(video: UploadFile = File(...)) -> JSONResponse:
    log.info("[analyze] request received: filename=%s content_type=%s", video.filename, video.content_type)

    if video.content_type not in ("video/mp4", "application/octet-stream", None):
        # Don't reject outright — clients sometimes send 'application/octet-stream'
        log.warning("[analyze] unexpected content_type=%s — proceeding", video.content_type)

    # Persist the upload to a temp working directory; analyze_video reads it
    # via OpenCV/ffmpeg so it needs a real on-disk path.
    with tempfile.TemporaryDirectory(prefix="cage_") as tmp:
        work_dir = Path(tmp)
        video_path = work_dir / (video.filename or "input.mp4")
        size_bytes = 0
        with video_path.open("wb") as fh:
            while True:
                chunk = await video.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                size_bytes += len(chunk)
        log.info("[analyze] saved upload: %s (%d bytes)", video_path, size_bytes)

        if size_bytes == 0:
            raise HTTPException(status_code=400, detail="empty video upload")

        try:
            features = analyze_video(video_path, work_dir)
        except Exception as exc:  # noqa: BLE001
            log.exception("[analyze] pipeline raised")
            return JSONResponse(
                status_code=500,
                content={"errors": [f"pipeline_unhandled: {exc}"]},
            )

    return JSONResponse(content=features)
