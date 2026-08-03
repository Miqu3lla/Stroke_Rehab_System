"""Offline voice-over generator for TheraMotion hint lines.

Run MANUALLY / offline (not part of the live app). It reads the single source
of truth for hint text — services.pose_service.HINT_TEXT — synthesizes one
audio clip per hint_key with VoxCPM, normalizes it, and writes:

  assets/voice/<hint_key>.<ext>   one clip per line
  assets/voice/manifest.json      hint_key -> {file, text, hash, voice_id}
  assets/voice/voice_script.json  hint_key -> text  (human-readable script)

The app plays clips by hint_key and falls back to text-only when a key has no
clip in the manifest, so it never breaks if a new hint is added before its
audio is generated.

SWAP THE VOICE LATER with zero app changes: edit scripts/voice/voice_config.json
(set voice.reference_wav + voice.reference_text to the therapist's recording,
bump voice.id), then re-run. The voice_id is part of each clip's hash, so
changing it re-generates every clip.

Idempotent: a clip is only re-synthesized when its text, voice, or output
format changed (tracked by hash in the manifest). Use --force to rebuild all.

Usage:
  python scripts/generate_voice.py --dry-run     # script+manifest only, no VoxCPM
  python scripts/generate_voice.py               # generate missing/changed clips
  python scripts/generate_voice.py --force       # rebuild every clip
  python scripts/generate_voice.py --upload      # also push clips+manifest to Storage

VoxCPM (only needed without --dry-run):  pip install voxcpm soundfile
ffmpeg: uses imageio-ffmpeg's bundled binary if present, else system ffmpeg.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

# Windows consoles/pipes default to cp1252, which can't encode Unicode like the
# checkmark we print per clip -> UnicodeEncodeError mid-run. Force UTF-8 output.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Load backend/.env so --upload has SUPABASE_URL + SERVICE_ROLE_KEY when this
# script is run standalone (the live app loads it via main_api; this doesn't
# import that). Optional — the dry-run and generation don't need it.
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except Exception:
    pass

from services.pose_service import HINT_TEXT  # single source of truth  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = SCRIPT_DIR / "voice" / "voice_config.json"


# ── config ─────────────────────────────────────────────────────────────────
def load_config(path: Path) -> Dict[str, Any]:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    cfg.setdefault("voice", {}).setdefault("id", "default")
    cfg["voice"].setdefault("reference_wav", None)
    cfg["voice"].setdefault("reference_text", None)
    # Resolve a relative reference path against the backend dir so cloning works
    # no matter the current working directory.
    ref = cfg["voice"].get("reference_wav")
    if ref and not Path(ref).is_absolute():
        cfg["voice"]["reference_wav"] = str((BACKEND_DIR / ref).resolve())
    cfg.setdefault("model_id", "openbmb/VoxCPM2")
    cfg.setdefault("device", "cuda")            # "cuda" for GPU, "cpu", or null=auto
    cfg.setdefault("load_denoiser", False)       # only needed to denoise a reference clip
    cfg.setdefault("synth_sample_rate", 48000)   # fallback if model rate can't be read
    cfg.setdefault("seed", None)                 # fix for reproducible prosody; null = random
    cfg.setdefault("synthesis", {"cfg_value": 2.0, "inference_timesteps": 10})
    out = cfg.setdefault("output", {})
    out.setdefault("dir", "assets/voice")
    out.setdefault("format", "m4a")
    out.setdefault("sample_rate", 24000)
    out.setdefault("channels", 1)
    out.setdefault("loudness_normalize", True)
    cfg.setdefault("storage", {"bucket": "exercise-audio", "prefix": "voice"})
    return cfg


def clip_hash(text: str, cfg: Dict[str, Any]) -> str:
    """Identity of a rendered clip. Any change here forces a re-render."""
    out = cfg["output"]
    parts = [
        text,
        cfg["voice"]["id"],
        str(cfg["voice"].get("reference_wav")),
        cfg["model_id"],
        out["format"],
        str(out["sample_rate"]),
        str(out["channels"]),
        str(out["loudness_normalize"]),
        json.dumps(cfg["synthesis"], sort_keys=True),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


# ── ffmpeg (transcode + loudness normalize) ─────────────────────────────────
def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"  # fall back to system ffmpeg on PATH


def _postprocess(raw_wav: Path, dest: Path, cfg: Dict[str, Any]) -> None:
    """Transcode raw synth WAV to the target format, mono, target sample rate,
    with EBU R128 loudness normalization so every clip is the same volume."""
    out = cfg["output"]
    af = "loudnorm=I=-16:TP=-1.5:LRA=11" if out["loudness_normalize"] else None
    cmd = [_ffmpeg_exe(), "-y", "-i", str(raw_wav),
           "-ac", str(out["channels"]), "-ar", str(out["sample_rate"])]
    if af:
        cmd += ["-af", af]
    cmd.append(str(dest))
    subprocess.run(cmd, check=True, capture_output=True)


# ── VoxCPM (isolated — the one place to adjust if the API differs) ──────────
_MODEL = None


def _get_model(cfg: Dict[str, Any]):
    global _MODEL
    if _MODEL is None:
        from voxcpm import VoxCPM  # lazy: only needed for real generation
        device = cfg.get("device") or None      # None -> VoxCPM auto-selects
        print(f"Loading VoxCPM model {cfg['model_id']} (device={device or 'auto'}) …")
        _MODEL = VoxCPM.from_pretrained(
            cfg["model_id"],
            device=device,
            load_denoiser=cfg.get("load_denoiser", False),
        )
    return _MODEL


def _output_sr(model, cfg: Dict[str, Any]) -> int:
    """The rate VoxCPM's waveform is actually at. VoxCPM2's AudioVAE v2 outputs
    48 kHz (v1 was 16 kHz). Read it off the model so we never MIS-LABEL the WAV
    — writing 48 kHz data as 16 kHz plays it ~3x too slow (slow-motion voice)."""
    for path in ("tts_model.sample_rate", "tts_model.audio_vae.out_sample_rate"):
        obj = model
        try:
            for attr in path.split("."):
                obj = getattr(obj, attr)
            if isinstance(obj, int) and obj > 0:
                return obj
        except Exception:
            pass
    return int(cfg.get("synth_sample_rate", 48000))


def _synthesize_wav(text: str, cfg: Dict[str, Any], dest_wav: Path) -> None:
    """Synthesize `text` to a WAV file at dest_wav using VoxCPM.

    Default voice when voice.reference_wav is null; voice cloning when it's set
    to a reference recording (+ its transcript in voice.reference_text).
    """
    import soundfile as sf
    model = _get_model(cfg)
    syn = cfg["synthesis"]
    seed = cfg.get("seed")
    if seed is not None:
        import torch
        torch.manual_seed(int(seed))
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(int(seed))
    wav = model.generate(
        text=text,
        prompt_wav_path=cfg["voice"].get("reference_wav"),
        prompt_text=cfg["voice"].get("reference_text"),
        cfg_value=syn.get("cfg_value", 2.0),
        inference_timesteps=syn.get("inference_timesteps", 10),
    )
    # Write at the model's TRUE output rate; _postprocess then resamples to the
    # configured output.sample_rate. Mislabeling here = chipmunk/slow-motion.
    sf.write(str(dest_wav), wav, _output_sr(model, cfg))


# ── main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Generate hint voice-over clips.")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--dry-run", action="store_true",
                    help="Write voice_script.json + manifest only; do NOT call VoxCPM.")
    ap.add_argument("--force", action="store_true", help="Re-render every clip.")
    ap.add_argument("--upload", action="store_true",
                    help="Upload changed clips + manifest to Supabase Storage.")
    args = ap.parse_args()

    cfg = load_config(Path(args.config))
    out_dir = (BACKEND_DIR / cfg["output"]["dir"]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = cfg["output"]["format"]
    manifest_path = out_dir / "manifest.json"
    script_path = out_dir / "voice_script.json"

    old_manifest: Dict[str, Any] = {}
    if manifest_path.exists():
        old_manifest = json.loads(manifest_path.read_text(encoding="utf-8")).get("clips", {})

    manifest_clips: Dict[str, Any] = {}
    changed: list[str] = []
    for key, text in HINT_TEXT.items():
        h = clip_hash(text, cfg)
        fname = f"{key}.{ext}"
        dest = out_dir / fname
        up_to_date = (
            not args.force
            and old_manifest.get(key, {}).get("hash") == h
            and dest.exists()
        )
        generated = False
        if not up_to_date and not args.dry_run:
            with tempfile.TemporaryDirectory() as td:
                raw = Path(td) / "raw.wav"
                _synthesize_wav(text, cfg, raw)
                _postprocess(raw, dest, cfg)
            generated = True
            changed.append(key)
            print(f"  ✓ {key}")
        elif not up_to_date and args.dry_run:
            changed.append(key)  # would generate

        # The recorded hash MUST describe the file actually on disk, or a later
        # run trusts it and skips regeneration. When we (re)generated or the
        # clip was already current, that's h. But a dry-run that WOULD have
        # regenerated leaves the old/absent file untouched, so we must keep its
        # stale hash (not h) — otherwise --dry-run permanently marks the stale
        # clip up-to-date and it never regenerates without --force.
        recorded_hash = h if (up_to_date or generated) else old_manifest.get(key, {}).get("hash")
        manifest_clips[key] = {
            "file": fname,
            "text": text,
            "hash": recorded_hash,
            "voice_id": cfg["voice"]["id"],
            "available": dest.exists(),
        }

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "voice_id": cfg["voice"]["id"],
        "format": ext,
        "storage": cfg["storage"],
        "clips": manifest_clips,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    script_path.write_text(
        json.dumps({k: v for k, v in HINT_TEXT.items()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    n_avail = sum(1 for c in manifest_clips.values() if c["available"])
    print(f"\n{'DRY RUN — ' if args.dry_run else ''}{len(HINT_TEXT)} keys | "
          f"{len(changed)} {'to generate' if args.dry_run else 'generated/updated'} | "
          f"{n_avail} clips present on disk")
    print(f"  manifest: {manifest_path}")
    print(f"  script:   {script_path}")

    if args.upload:
        _upload(out_dir, manifest_path, manifest_clips, cfg)
    return 0


def _upload(out_dir: Path, manifest_path: Path, clips: Dict[str, Any], cfg: Dict[str, Any]) -> None:
    """Push clips + manifest to Supabase Storage via the existing helper."""
    from core.supabase_db import upload_to_storage
    bucket = cfg["storage"]["bucket"]
    prefix = cfg["storage"]["prefix"].strip("/")
    ctype = {"m4a": "audio/mp4", "mp3": "audio/mpeg", "wav": "audio/wav"}.get(cfg["output"]["format"], "application/octet-stream")
    n = 0
    for key, meta in clips.items():
        f = out_dir / meta["file"]
        if not f.exists():
            continue
        upload_to_storage(bucket, f"{prefix}/{meta['file']}", f.read_bytes(), ctype)
        n += 1
    upload_to_storage(bucket, f"{prefix}/manifest.json", manifest_path.read_bytes(), "application/json")
    print(f"  uploaded {n} clips + manifest to {bucket}/{prefix}/")


if __name__ == "__main__":
    raise SystemExit(main())
