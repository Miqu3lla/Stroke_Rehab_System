"""Generate several candidate VoxCPM voices so a single, CONSISTENT voice can
be chosen for all hint clips.

VoxCPM's default voice (no reference) is randomly sampled per call, so every
hint clip ends up a different speaker. To fix all clips to ONE voice we clone a
reference. This script renders the same sentence with several different seeds ->
each a distinct voice -> saves:

  scripts/voice/candidates/candidate_<seed>.wav   reusable reference for cloning
  scripts/voice/candidates/candidate_<seed>.m4a   audition clip (uploaded)

and uploads the .m4a auditions to exercise-audio/voice-candidates/ so you can
play them in Supabase Storage and pick one. Then set that seed's WAV as
voice.reference_wav in voice_config.json and re-run generate_voice.py --force.

Usage:  python scripts/voice/make_candidates.py
        python scripts/voice/make_candidates.py --seeds 1 2 3 4 5 6 --no-upload
"""
import argparse
import importlib.util
import sys
from pathlib import Path

import soundfile as sf
import torch

VOICE_DIR = Path(__file__).resolve().parent          # backend/scripts/voice
BACKEND = VOICE_DIR.parent.parent                     # backend

# Reuse generate_voice's model loading / postprocess / config so the audition
# clips are produced exactly like the real ones (same rate handling, loudnorm).
_spec = importlib.util.spec_from_file_location("gv", BACKEND / "scripts" / "generate_voice.py")
gv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gv)

# A representative coaching line so you hear how the app will actually sound.
SENTENCE = "Great form. Raise your arm up, and hold it there."


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3, 4, 5, 6])
    ap.add_argument("--sentence", default=SENTENCE)
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args()

    cfg = gv.load_config(VOICE_DIR / "voice_config.json")
    model = gv._get_model(cfg)
    sr = gv._output_sr(model, cfg)
    syn = cfg["synthesis"]

    cand_dir = VOICE_DIR / "candidates"
    cand_dir.mkdir(parents=True, exist_ok=True)

    made = []
    for seed in args.seeds:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        wav = model.generate(
            text=args.sentence,
            cfg_value=syn.get("cfg_value", 2.0),
            inference_timesteps=syn.get("inference_timesteps", 10),
        )
        raw = cand_dir / f"candidate_{seed}.wav"      # reference for cloning
        sf.write(str(raw), wav, sr)
        m4a = cand_dir / f"candidate_{seed}.m4a"        # audition clip
        gv._postprocess(raw, m4a, cfg)
        made.append((seed, m4a))
        print(f"  candidate seed={seed} -> {m4a.name}")

    if not args.no_upload:
        from core.supabase_db import upload_to_storage
        bucket = cfg["storage"]["bucket"]
        for seed, m4a in made:
            upload_to_storage(bucket, f"voice-candidates/candidate_{seed}.m4a",
                              m4a.read_bytes(), "audio/mp4")
        print(f"\nUploaded {len(made)} auditions to {bucket}/voice-candidates/")

    print(f"\nSentence: {args.sentence!r}")
    print("Audition them in Supabase Storage (voice-candidates/), then tell me the seed you like.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
