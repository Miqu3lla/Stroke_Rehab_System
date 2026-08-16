# Stroke Rehab System

Mobile-Based Computer Vision and Machine Learning application for stroke rehabilitation.

Forged and run on NVIDIA Blackwell architecture (RTX 5060 Ti) with PyTorch 2.11.0+cu128.

## Project Goal

This system acts as a digital physical therapist by combining:

1. React Native mobile app for guided exercise sessions.
2. MediaPipe pose extraction for 33-point skeletal tracking.
3. LSTM-based movement form classification (correct vs incorrect).
4. Random Forest recommendation engine for adaptive exercise plans.

## Why This Matters

Stroke patients often lose supervised feedback after clinic sessions. This project closes that gap with real-time guidance, safer at-home rehabilitation, and progress-aware exercise recommendations.

## Project Structure

```text
Stroke_Rehab_System/
├── README.md
├── docker-compose.yaml
├── datasets/
│   ├── archive/
│   ├── Ready_Dataset/
│   └── processed_data/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main_api.py                 # thin FastAPI entry, mounts routers
│   ├── cloudflared/
│   │   └── cloudflared.exe
│   ├── models/
│   │   ├── lstm_weights.pth
│   │   └── rf_recommender.pkl
│   ├── core/                       # domain logic (pure functions, no FastAPI)
│   │   ├── auth.py                 # JWT verification + patient-ownership guard
│   │   ├── exercise_catalog.py     # catalog + difficulty overlays + body-area filter
│   │   ├── mediapipe_vision.py     # MediaPipe pose extraction
│   │   ├── neural_network.py       # LSTM form classifier
│   │   ├── recommender.py          # trajectory-adapted session picker (dual-mode variants)
│   │   ├── supabase_db.py          # Supabase / Postgres access (docker -> psycopg2 -> REST)
│   │   └── trajectory.py           # Patient X loop: progressing / plateauing / deteriorating
│   ├── routers/                    # FastAPI route handlers (thin, validation only)
│   │   ├── patients.py             # POST /patients
│   │   ├── pose.py                 # POST /pose/estimate
│   │   ├── predictions.py          # POST /predict/form, /predict/form-from-video
│   │   ├── recommendations.py      # GET  /recommendation/{patient_id}
│   │   └── sessions.py             # POST /sessions (batch per-set results)
│   ├── schemas/                    # Pydantic request/response models
│   │   ├── patient.py
│   │   ├── pose.py
│   │   └── prediction.py
│   ├── services/                   # cross-cutting helpers used by routers
│   │   └── pose_service.py         # angle + form-score + RepCounter + hints
│   └── scripts/
│       ├── dataset_splitter.py
│       └── train_model.py
└── frontend/
    ├── Dockerfile
    ├── App.js
    ├── index.js
    ├── app.json
    ├── package.json
    ├── babel.config.js
    ├── metro.config.js
    ├── tailwind.config.js
    ├── global.css
    └── src/
        ├── components/
        │   ├── Auth/               # LoginCard, SignupCard
        │   ├── exercise/           # CameraComponent, SkeletonOverlay, BeforeYouStart,
        │   │                       # BreakScreen, RestState, RecommendationCard,
        │   │                       # HistoryList, OverallProgressCard, SessionModeToggle
        │   ├── onboarding/         # OnboardingNav, QuestionCard (options + multi-field)
        │   ├── profile/            # PatientHeaderProfile, ClinicalSummary
        │   └── ui/                 # ExerciseModal, Skeleton, navbar
        ├── constants/
        │   └── exerciseTypes.js    # LSTM-supported set, display names
        ├── hooks/
        │   ├── useCamera.js        # per-set frame loop + rep/hold tracking
        │   ├── useOnboarding.js    # onboarding step machine + submit
        │   ├── useOverallProgress.js # aggregates history into progress curve
        │   └── usePoseDetection.js # WS pose loop + LSTM classify on finish
        ├── lib/
        │   └── api.js              # axios client for the backend
        ├── navigation/
        │   └── index.js            # React Navigation stack (protected routes)
        ├── screens/                # Login, Signup, Onboarding, Home, Session,
        │                           # Exercise, SessionSummary, PatientProfile
        ├── services/
        │   └── supabase.js
        ├── store/                  # Zustand stores
        │   ├── useAuthStore.js
        │   ├── usePatientStore.js  # recommendations + history + mode toggle
        │   ├── usePatientProfileStore.js # profile fetch + name editing
        │   └── useSessionStore.js  # active session state machine
        └── utils/
            ├── duration.js         # session/duration label formatting
            ├── passwordPolicy.js   # signup password rules + validation
            └── repCounter.js       # CV rep state machine + limb/color helpers
```

## Prerequisites

- Python 3.10+ with `pip`
- Node.js 18+ with `npm`
- Android Studio with an AVD created (e.g. `Medium_Phone_API_35`)
- `cloudflared` (bundled at `backend/cloudflared/cloudflared.exe`)
- Cloudflare tunnel token (set as `CLOUDFLARED_TOKEN`)

## Environment Variables

Create `backend/.env` with the Supabase credentials. The backend rejects
every request to a protected route unless the JWT in the
`Authorization: Bearer ...` header verifies against the project's JWKS,
fetched from `SUPABASE_URL` (ES256 — see `backend/core/auth.py`). There is
no shared secret to configure; `SUPABASE_URL` is what auth actually depends
on, not just DB/storage config.

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # backend writes, bypasses RLS
```

Frontend reads from `frontend/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

## One-Time Install

**Backend:**

```powershell
cd backend
pip install -r requirements.txt
```

**Frontend:**

```powershell
cd frontend
npm install
```

## Running the System

You need three terminals running at the same time: the API, the tunnel, and the emulator + Expo dev server.

### Terminal 1 — Main API

```powershell
cd backend
python -m uvicorn main_api:app --host 0.0.0.0 --port 8001
```

Wait for `Application startup complete`. The API is now reachable at `http://localhost:8001`.

### Terminal 2 — Cloudflare Tunnel

```powershell
cd backend
.\cloudflared\cloudflared.exe tunnel run --token $env:CLOUDFLARED_TOKEN
```

This exposes the local API at `https://api.necookie.dev`. Verify in another terminal:

```powershell
curl https://api.necookie.dev/health
```

Expected response: `{"status":"ok","service":"stroke-rehab-backend"}`

### Terminal 3 — Android Emulator + Expo

Boot the emulator:

```powershell
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:ANDROID_SDK_ROOT\emulator\emulator.exe" -avd Medium_Phone_API_35 -netdelay none -netspeed full
```

Once the emulator window finishes booting (~30–45 seconds), start Expo:

```powershell
cd frontend
npx expo start --android
```

The TheraMotion app will bundle and launch on the emulator automatically.

## Expo Dev Server Shortcuts

While Expo is running:

- `r` — Reload app
- `a` — Relaunch on Android
- `j` — Open debugger
- `m` — Toggle dev menu
- `Ctrl+C` — Stop server

## API Endpoints

- `GET  /health` — Service health check.
- `POST /patients` — Save patient onboarding profile (first/last name, recovery, affected area/side).
- `WS   /ws/pose` — Realtime pose channel. Client opens one socket per exercise, sends a JWT auth handshake, then streams JPEG frames and receives per-frame landmarks + form score + band colors. Replaces the per-frame HTTP overhead of `/pose/estimate`.
- `POST /pose/estimate` — One-shot MediaPipe on a base64 frame → 33 landmarks + form score. Legacy single-frame path, kept for non-streaming callers.
- `POST /predict/form` — Classify a pre-extracted pose sequence (LSTM).
- `POST /predict/form-from-video` — Upload a video, extract poses, classify form.
- `GET  /recommendation/{patient_id}` — Trajectory-adapted exercise plan (Patient X loop). Returns both `functionality` and `strength` variants in one response so the client can toggle modes with no refetch.
- `POST /sessions` — Batch-persist a finished session's per-exercise results, including the structured per-set `set_results[]` (rep form % / hold completion %) for the therapist fatigue curve.

Protected routes require a valid Supabase JWT in the `Authorization: Bearer ...` header (the `/ws/pose` socket authenticates via its first handshake message instead, to keep the token out of proxy logs).

Public versions live under `https://api.necookie.dev/*`. Interactive docs at `https://api.necookie.dev/docs`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `https://api.necookie.dev/health` fails | Confirm Terminal 1 (API) and Terminal 2 (tunnel) are both running. |
| Emulator can't reach `localhost` | Use `http://10.0.2.2:8001` from inside the emulator, or hit the tunnel URL. |
| "Cannot connect to adb daemon" | `& "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe" kill-server` then retry. |
| Image too large (HTTP 413) | Frame exceeds 7.5 MB decoded — lower camera quality or resolution. |
| App freezes on bundle | Close other Android emulators and ensure GPU acceleration is on. |

## Docker (Optional)

For a containerized run instead of local Python/Node:

```bash
docker compose up --build
```

- Backend → `http://localhost:8002` (host 8002 maps to the container's 8000; avoids colliding with a local-Python API on 8001)
- Frontend (Expo) → `http://localhost:8081`

The backend image uses the CUDA 12.8 PyTorch wheel and requests `gpus: all`. Docker Desktop must have GPU support enabled.

## Training (Optional)

To retrain the LSTM weights from the prepared dataset:

```powershell
cd backend/scripts
python train_model.py --data-dir ../../datasets/processed_data --out ../models/lstm_weights.pth --epochs 10
```

Output artifact: `backend/models/lstm_weights.pth`

## Notes

1. The recommender loads `backend/models/rf_recommender.pkl` when available, then falls back to rule-based recommendations.
2. Dataset folders are scaffolded under `datasets/Ready_Dataset/{train,val,test}`.
3. The model files in `backend/models/` are placeholders until you train and save real weights.
4. This project is developed and run on **NVIDIA Blackwell architecture (RTX 5060 Ti, 16GB)** with PyTorch 2.11.0+cu128 (CUDA 12.8).
