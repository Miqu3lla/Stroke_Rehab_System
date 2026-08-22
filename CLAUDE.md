# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stroke Rehab System ("TheraMotion") — a mobile-based computer vision + ML app that acts as a digital
physical therapist. React Native (Expo) frontend + FastAPI backend, with MediaPipe pose extraction,
an LSTM movement-form classifier, and a Random Forest recommendation engine.

## Comment Style

When fixing CodeRabbit findings or any other bug/issue, keep comments inline and short (1-2 lines max).
No block/docstring-style explanations of what the code does — only note non-obvious "why" when needed.

## Conventions

- **ASCII-only in backend log/print messages.** No em-dashes, arrows, or other non-ASCII — the Windows
  console is cp1252 and a non-interactive/redirected run crashes on encode. Use `-` not `—`, `->` not `→`.

## Commands

### Backend (from `backend/`)

```powershell
pip install -r requirements.txt
python -m uvicorn main_api:app --host 0.0.0.0 --port 8001
```

No backend test suite exists yet (no `pytest`/`test_*.py` files). Verify changes manually via
`http://localhost:8001/docs` or `curl http://localhost:8001/health`.

Retrain the LSTMs. The live models are **per-exercise** (`models/lstm_<slug>.pth`), trained against the
split dataset under `datasets/Ready_Dataset/{train,val,test}/<Exercise> {Correct,Incorrect}/` (gitignored;
clips are Git LFS). Train all four at once, or one exercise via a driver script:

```powershell
cd backend/scripts
python train_model.py --per-exercise --batch-size 16      # all exercises -> lstm_<slug>.pth
python train_sit_to_stand.py                              # one exercise (reproduction recipe)
```

Any training script that sets `num_workers > 0` MUST guard its entrypoint with `if __name__ == "__main__":`
— Windows spawns DataLoader workers by re-importing the module, so an unguarded top-level `train_lstm(...)`
call recurses and crashes.

### Frontend (from `frontend/`)

```bash
npm install
npm run android   # or npm start / npm run ios / npm run web
```

No frontend test suite is configured (no test script in `package.json`). This is an Expo/React Native
project — there is no `npm run build`; verify UI changes by running the app on the emulator (see README's
three-terminal setup: API, Cloudflare tunnel, Android emulator + Expo).

### Docker (optional, full stack)

```bash
docker compose up --build
```

Backend → `http://localhost:8002` (maps to container's 8000), Frontend → `http://localhost:8081`.

## Architecture

### Backend layering (`backend/`)

Strict separation enforced by convention — respect it when adding code:

- `routers/` — FastAPI route handlers only. Thin: request validation + calling `core`/`services`, no
  business logic.
- `core/` — pure domain logic, no FastAPI imports. Includes `auth.py` (JWT), `supabase_db.py` (DB access),
  `trajectory.py`, `recommender.py`, `neural_network.py` (LSTM), `mediapipe_vision.py`, `exercise_catalog.py`.
- `schemas/` — Pydantic request/response models.
- `services/` — cross-cutting helpers used by routers (e.g. `pose_service.py`: angle math, form scoring,
  `RepCounter`, coaching hints).

`main_api.py` is a thin entrypoint: mounts routers, sets up rate limiting (slowapi, limiter lives on
`app.state.limiter`), and warms the LSTM model in a background thread at startup (`lifespan`) so the
first classification request doesn't pay model-load latency.

### Auth model

Every protected route depends on `verify_jwt` (`core/auth.py`), which validates the Supabase-issued
HS256 JWT from `Authorization: Bearer <token>` against `SUPABASE_JWT_SECRET`. `/health` and
`POST /auth/check-email` are the only public routes — the latter runs pre-login (forgot-password flow)
so it can't require a token; it's rate-limited tighter than the app floor (5/minute) since it's an
intentional account-enumeration surface (see `core/supabase_db.py`'s `email_exists_in_auth`).
Any handler taking a `patient_id` must additionally call `assert_patient_match(claims, patient_id)` —
without it an authenticated user could act on someone else's patient record (RLS is a second layer, not
a substitute). The `/ws/pose` websocket authenticates via its first handshake message instead of a
header, to keep the token out of proxy logs.

### Persistence (`core/supabase_db.py`)

Multi-tier fallback for reaching Postgres/Supabase, tried in order: direct `psycopg2` connection → `docker
exec` into the `supabase-db` container running `psql` → Supabase REST via Kong (HTTP). All helpers return
a standardized `{stored, status_code, data}` dict. Any value spliced into a SQL string or URL (table names,
patient IDs, session keys) must pass one of the module's regex gates (`_UUID_RE`, `_SAFE_IDENT_RE`,
`_SAFE_SESSION_RE`) first — psycopg2/psql can't parameter-bind identifiers. REST calls carry a spoofed
browser `User-Agent` because the Cloudflare tunnel in front of Supabase blocks non-browser UAs.

### Pose pipeline

Two paths to the same MediaPipe/LSTM core:

- `WS /ws/pose` — realtime per-exercise socket; client streams JPEG frames, server returns landmarks +
  form score + band colors per frame. This is the primary path (avoids per-frame HTTP overhead).
- `POST /pose/estimate` — legacy one-shot HTTP path for non-streaming callers, still maintained.

`POST /predict/form` classifies a pre-extracted pose sequence; `POST /predict/form-from-video` does
extraction + classification from an uploaded video in one call.

### Form classifier (per-exercise LSTM, `core/neural_network.py`)

There is **one specialized binary classifier per exercise** (`models/lstm_<slug>.pth`), not one global
model. All four supported exercises (`LSTM_SUPPORTED_EXERCISE_TYPES` in `exercise_catalog.py` —
`shoulder_flexion`, `hand_to_mouth`, `sit_to_stand`, `knee_extension`) ship their own trained checkpoint;
`_load_model_for` resolves per-exercise → global (`lstm_weights.pth`) → rule-based. The global fallback is
effectively dead now (`_GLOBAL_FALLBACK_OK` is empty), so `warmup_model()` logs a loud warning if any
required `lstm_<slug>.pth` is missing — a fresh machine falling back to the global model would silently
misclassify.

Watch these invariants when touching the classifier:

- **`StrokeLSTMClassifier` is duplicated** in `scripts/train_model.py` and `core/neural_network.py` and the
  two definitions MUST stay byte-identical, or `load_state_dict` mismatches silently corrupt inference.
- **Readout must match how the checkpoint was trained.** Default is last-timestep; `knee_extension` uses
  `maxpool` (its correct/incorrect signal is a transient mid-clip peak the last timestep misses), gated by
  `POOLED_READOUT_SLUGS`. A mismatch loads fine but scores garbage.
- **`knee_extension` is a hybrid**: pooled LSTM + a geometric veto (`_knee_reaches_extension`) that forces
  "incorrect" when the leg never sustains near-full extension, regardless of the net. It tags `model_source`
  with `+geo_veto`.
- **The `.pth` and its `_metrics.json` are version-controlled** via `!` exceptions in `.gitignore` (the
  metrics file is the evidence trail for a model's reported accuracy). Everything else in `models/` is
  ignored. When adding a new per-exercise model, add the `!backend/models/lstm_<slug>.pth` exception too.

### Session evidence videos (`core/session_video.py`)

Piggybacks on the `/ws/pose` stream (no second device recording): buffers ~10s of raw JPEGs the patient is
visible for, encodes a browser-playable H.264 clip on a background thread, uploads to the private
`session-evidence` Storage bucket, writes a `session_videos` row, then purges the patient's clips from
earlier sessions. Best-effort — any failure is logged and swallowed so pose scoring never blocks on it. The
retention purge is DB-driven (it only deletes clips that have a row), so `insert_session_video` must fall
through all persistence tiers rather than early-return on the first failure — otherwise a missing row
silently disables the purge and clips stack.

### Recommendation engine

`core/recommender.py` implements the "Patient X loop": trajectory-adapted exercise selection based on
whether a patient is progressing / plateauing / deteriorating (`core/trajectory.py`). Loads
`backend/models/rf_recommender.pkl` when present, otherwise falls back to rule-based recommendations.
`GET /recommendation/{patient_id}` returns both `functionality` and `strength` variants in one response
so the client can toggle modes without refetching.

### Frontend structure (`frontend/src/`)

- `store/` — Zustand stores are the source of truth for cross-screen state: `useAuthStore`,
  `usePatientStore` (recommendations + history + mode toggle), `usePatientProfileStore`,
  `useSessionStore` (active session state machine).
- `hooks/useCamera.js` — per-set frame capture loop + rep/hold tracking; feeds `usePoseDetection.js`,
  which runs the `/ws/pose` loop and triggers LSTM classification when a set finishes.
- `hooks/useOnboarding.js` — onboarding step machine + submission to `POST /patients`.
- `lib/api.js` — axios client; attaches the Supabase JWT via interceptor on every backend request.
- `utils/repCounter.js` — client-side CV rep-counting state machine mirroring backend rep logic, plus
  limb/color helpers for the skeleton overlay.
- Screens follow the flow: Login/Signup → Onboarding → Home → Session → Exercise → SessionSummary →
  PatientProfile, gated by protected routes in `navigation/index.js`.

## Environment

Backend needs `backend/.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
Frontend needs `frontend/.env` with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. See
README for the full three-terminal local dev flow (API, Cloudflare tunnel, Android emulator + Expo) —
the emulator must reach the API via `http://10.0.2.2:8001`, not `localhost`.

This project is developed against NVIDIA Blackwell (RTX 5060 Ti) with PyTorch 2.11.0+cu128 (CUDA 12.8);
`requirements.txt` pins the matching `torch==2.11.0+cu128` wheel.
