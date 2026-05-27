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
├── docs/
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
│   │   ├── exercise_catalog.py     # catalog + difficulty overlays + body-area filter
│   │   ├── mediapipe_vision.py     # MediaPipe pose extraction
│   │   ├── neural_network.py       # LSTM form classifier
│   │   ├── recommender.py          # trajectory-adapted session picker
│   │   ├── supabase_db.py          # Supabase / Postgres access (docker -> psycopg2 -> REST)
│   │   └── trajectory.py           # Patient X loop: progressing / plateauing / deteriorating
│   ├── routers/                    # FastAPI route handlers (thin, validation only)
│   │   ├── patients.py             # POST /patients
│   │   ├── pose.py                 # POST /pose/estimate
│   │   ├── predictions.py          # POST /predict/form, /predict/form-from-video
│   │   ├── recommendations.py      # GET  /recommendation/{patient_id}
│   │   └── sessions.py             # POST /sessions
│   ├── schemas/                    # Pydantic request/response models
│   │   ├── patient.py
│   │   ├── pose.py
│   │   └── prediction.py
│   ├── services/                   # cross-cutting helpers used by routers
│   │   └── pose_service.py         # angle + form-score + patient-friendly hints
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
        │   │                       # RestState, RecommendationCard, HistoryList
        │   ├── onboarding/         # OnboardingNav, QuestionCard
        │   └── ui/                 # ExerciseModal, Skeleton, navbar, sidebar
        ├── constants/
        │   └── exerciseTypes.js    # LSTM-supported set, display names
        ├── hooks/
        │   ├── useCamera.js        # frame capture + keypoint buffering
        │   ├── useOnboarding.js
        │   └── usePoseDetection.js # POST /pose/estimate + LSTM classify on finish
        ├── lib/
        │   └── api.js              # axios client for the backend
        ├── navigation/
        │   └── index.js            # React Navigation stack (protected routes)
        ├── screens/                # Login, Signup, Onboarding, Home,
        │                           # Exercise, SessionSummary
        ├── services/
        │   └── supabase.js
        ├── store/                  # Zustand stores
        │   ├── useAuthStore.js
        │   ├── usePatientStore.js  # recommendations + history
        │   └── useSessionStore.js  # active session state machine
        └── utils/
            └── sequenceFormatter.js
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
`Authorization: Bearer ...` header validates against `SUPABASE_JWT_SECRET`.

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # backend writes, bypasses RLS
SUPABASE_JWT_SECRET=<jwt-secret>                # Settings → API → JWT Settings
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
- `POST /patients` — Save patient onboarding profile.
- `POST /pose/estimate` — Run MediaPipe on a base64-encoded frame and return 33 landmarks + form score.
- `POST /predict/form` — Classify a pre-extracted pose sequence (LSTM).
- `POST /predict/form-from-video` — Upload a video, extract poses, classify form.
- `GET  /recommendation/{patient_id}` — Trajectory-adapted exercise plan (Patient X loop).
- `POST /sessions` — Batch-persist a finished session's per-exercise results.

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

- Backend → `http://localhost:8001`
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
