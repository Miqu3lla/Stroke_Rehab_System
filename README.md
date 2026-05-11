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
├── .gitignore
├── .dockerignore
├── docker-compose.yaml
├── docs/
│   ├── Concept_Paper.docx
│   └── Title_Defense.pptx
├── datasets/
│   ├── archive/
│   ├── Ready_Dataset/
│   │   ├── train/
│   │   ├── val/
│   │   └── test/
│   └── processed_data/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main_api.py
│   ├── models/
│   │   ├── lstm_weights.pth
│   │   └── rf_recommender.pkl
│   ├── core/
│   │   ├── mediapipe_vision.py
│   │   ├── neural_network.py
│   │   └── recommender.py
│   └── scripts/
│       ├── dataset_splitter.py
│       └── train_model.py
└── frontend/
    ├── Dockerfile
    ├── assets/
    ├── src/
    │   ├── api/
    │   ├── components/
    │   │   ├── common/
    │   │   └── exercise/
    │   ├── constants/
    │   ├── hooks/
    │   ├── navigation/
    │   ├── screens/
    │   ├── services/
    │   ├── store/
    │   └── utils/
    ├── App.js
    ├── app.json
    ├── index.js
    ├── tailwind.config.js
    └── package.json
```

## Frontend Setup (Expo)

1. Open terminal at project root.
2. Run:

```bash
cd frontend
npm install
npx expo start
```

## Android Emulator Setup & Testing

### Prerequisites

- Android Studio installed with Android SDK
- Emulator already created (AVD: `Medium_Phone_API_35`)
- Backend API running with Cloudflare tunnel active

### Step 1: Start Backend API (Terminal 1)

```powershell
cd backend
python -m uvicorn main_api:app --reload --host 0.0.0.0 --port 8001
```

Wait for: `Application startup complete`

### Step 2: Start Cloudflare Tunnel (Terminal 2)

```powershell
cd backend
$env:CLOUDFLARED_TOKEN = "YOUR_TOKEN_HERE"
.\cloudflared\cloudflared.exe tunnel run --token $env:CLOUDFLARED_TOKEN
```

Verify tunnel works:
```powershell
curl https://api.necookie.dev/health
```

Expected: `{"status":"ok","service":"stroke-rehab-backend"}`

### Step 3: Launch Android Emulator (Terminal 3)

```powershell
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:ANDROID_SDK_ROOT\emulator\emulator.exe" -avd Medium_Phone_API_35 -netdelay none -netspeed full
```

Wait 30-45 seconds for the emulator window to appear and boot.

### Step 4: Start Expo Dev Server (Terminal 4)

```powershell
cd frontend
npx expo start --android --tunnel
```

When prompted about installing `@expo/ngrok`, press `Y`. The app will:
1. Bundle all modules (35-40 seconds)
2. Automatically launch on the emulator
3. Display a QR code

The emulator should now show your **TheraMotion** app!

### Quick Run (copy/paste)

Use these PowerShell commands when developing on Windows — one terminal per step.

- Terminal 1 — Backend (start Uvicorn on :8002)
```powershell
cd backend
$env:SUPABASE_URL = "http://localhost:8000"
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5432"
$env:POSTGRES_DB = "postgres"
$env:POSTGRES_USER = "supabase_admin"
$env:POSTGRES_PASSWORD = "Bossman1234"
$env:SUPABASE_DOCKER_CONTAINER = "supabase-db"
python -m uvicorn main_api:app --host 0.0.0.0 --port 8002
```

- Terminal 2 — Cloudflared tunnel (optional; replace token)
```powershell
cd backend
# If using the bundled cloudflared.exe:
.\cloudflared\cloudflared.exe tunnel run eyJhIjoiNjY4Zjc4YzVhOTU4MWM1MDUxYmQ2MGE0OTg1ZDYxNjYiLCJzIjoiWlRKa1pHVTJaR1l0T0RBNE1DMDBNVFF3TFRreU1UVXRabUV3TUdZME16QXpZV1V6IiwidCI6ImZkM2NlNTE1LTU5MjktNDdiZC1hYTY5LTA1MjczOWY4ZmY1MiJ9
# Or, if cloudflared is on PATH:
cloudflared tunnel run eyJhIjoiNjY4Zjc4YzVhOTU4MWM1MDUxYmQ2MGE0OTg1ZDYxNjYiLCJzIjoiWlRKa1pHVTJaR1l0T0RBNE1DMDBNVFF3TFRreU1UVXRabUV3TUdZME16QXpZV1V6IiwidCI6ImZkM2NlNTE1LTU5MjktNDdiZC1hYTY5LTA1MjczOWY4ZmY1MiJ9
```

- Terminal 3 — Android emulator (start AVD)
```powershell
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:ANDROID_SDK_ROOT\emulator\emulator.exe" -avd Medium_Phone_API_35 -netdelay none -netspeed full
```

- Terminal 4 — Expo (LAN mode — recommended for emulator)
```powershell
cd frontend
npx expo start --lan
# then press "a" to open on the Android emulator or scan the QR with Expo Go on a real device
```

Notes:
- Replace `YOUR_CLOUDFLARED_TOKEN_HERE` with your real Cloudflare token when using tunnels.
- From the Android emulator use `http://10.0.2.2:8002` to reach the backend running on your host.
- For a real phone, use your PC's LAN IP (for example `http://192.168.1.42:8002`) or the cloudflared tunnel URL.
- Ensure Windows Firewall allows inbound connections to port `8002` if using a real device over LAN.


### Testing the App

**Quick Tests:**

1. **Health Check** — Check if backend is reachable:
   ```powershell
   curl https://api.necookie.dev/health
   ```

2. **Recommendation Endpoint** — Test exercise recommendations:
   ```powershell
   curl -X POST https://api.necookie.dev/recommendation `
     -H "Content-Type: application/json" `
     -d '{
       "patient_id": "P001",
       "stroke_type": "ischemic",
       "months_in_recovery": 3,
       "latest_form_score": 0.75,
       "affected_area": "legs",
       "affected_side": "left"
     }'
   ```

3. **Interactive Testing** — Navigate through the app on the emulator and verify:
   - Screens load without errors
   - No API connection issues
   - Recommendations display correctly

**Expo Terminal Commands:**

- **r** — Reload app (after code changes)
- **a** — Relaunch emulator
- **w** — Open web version
- **j** — Open debugger
- **m** — Toggle menu
- **Ctrl+C** — Stop dev server

### Troubleshooting

| Issue | Solution |
|-------|----------|
| App shows "Text strings must be rendered within a <Text> component" | Raw text is outside `<Text>` wrapper. Press `r` to reload. |
| Backend unreachable | Ensure tunnel is running and `https://api.necookie.dev/health` returns 200. |
| Emulator slow or freezing | Close other apps. Check GPU acceleration is enabled in emulator settings. |
| "Cannot connect to adb daemon" | Restart adb: `$env:ANDROID_SDK_ROOT\platform-tools\adb kill-server` |

## Database Setup (Supabase)

The app stores onboarding data in your Supabase database using the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values from your local Supabase Docker setup.

### Environment variables for FastAPI

Set these in your backend environment before starting Uvicorn. Use the values from your local Supabase Docker stack:

```powershell
$env:SUPABASE_URL = "http://localhost:8000"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY"
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5432"
$env:POSTGRES_DB = "postgres"
$env:POSTGRES_USER = "supabase_admin"
$env:POSTGRES_PASSWORD = "YOUR_POSTGRES_PASSWORD"
```

### Create the `patients` table

Run this in the Supabase SQL editor:

```sql
create table if not exists public.patients (
   id uuid primary key default gen_random_uuid(),
   name text not null,
   stroke_type text not null,
   months_in_recovery text not null,
   months_in_recovery_value integer not null default 0,
   affected_part text not null,
   affected_area text not null,
   affected_side text not null,
   source_app text not null default 'frontend',
   onboarding_payload jsonb not null default '{}'::jsonb,
   created_at timestamptz not null default now()
);
```

### Create the `recommendation_logs` table

```sql
create table if not exists public.recommendation_logs (
   id uuid primary key default gen_random_uuid(),
   patient_id text null,
   stroke_type text not null,
   months_in_recovery integer not null,
   latest_form_score numeric(4,3) not null,
   affected_area text not null,
   affected_side text not null,
   recommendation jsonb not null,
   created_at timestamptz not null default now()
);
```

### What gets saved from the app

The onboarding screen sends these values to `POST /patients`:

- `name`
- `stroke_type`
- `months_in_recovery`
- `affected_part`
- `affected_side`

FastAPI stores the raw inputs and also saves normalized fields for querying.

## Docker Setup

The project now includes Docker files for both services and a root compose file.

### Build and run

```bash
docker compose up --build
```

### Services and ports

1. Backend API: `http://localhost:8002`
2. Frontend Expo: `http://localhost:8081`

### Notes

1. Backend host port uses `8002` so it does not collide with your local Supabase Docker service on `8001`.
2. The backend container still listens internally on `8000`.
3. The root `.dockerignore` keeps build contexts small and avoids copying local caches, node_modules, and dataset archives into image builds.
4. Backend Docker uses the CUDA 12.8 PyTorch wheel (`torch==2.11.0+cu128`) and requests GPU access with `gpus: all`.
5. To use the RTX 5060 Ti inside Docker, Docker Desktop must have GPU support enabled and the NVIDIA container runtime must be available on the host.

## Quick Start (API + Tunnel)

**Fastest way to get the backend running with public access:**

1. Set tunnel token (one-time):

```powershell
$env:CLOUDFLARED_TOKEN = "YOUR_TUNNEL_TOKEN_HERE"
```

2. From VS Code: **Terminal → Run Task → Run API & Tunnel**
   
   Done! Backend runs on `http://localhost:8002` and `https://api.necookie.dev`

**Alternative: Two-terminal setup**

````powershell
# Terminal 1
cd backend
python -m uvicorn main_api:app --host 0.0.0.0 --port 8002

# Terminal 2
cd backend
.\cloudflared\cloudflared.exe tunnel run --token eyJhIjoiNjY4Zjc4YzVhOTU4MWM1MDUxYmQ2MGE0OTg1ZDYxNjYiLCJzIjoiWlRKa1pHVTJaR1l0T0RBNE1DMDBNVFF3TFRreU1UVXRabUV3TUdZME16QXpZV1V6IiwidCI6ImZkM2NlNTE1LTU5MjktNDdiZC1hYTY5LTA1MjczOWY4ZmY1MiJ9

**Test it:**
```powershell
curl http://localhost:8002/health
curl https://api.necookie.dev/health
````

---

## Backend Setup (FastAPI + CV-ML)

This project backend uses the current active Python interpreter.

### 1. Install backend dependencies

1. Open terminal at project root.
2. Run:

```bash
cd backend
pip install -r requirements.txt
```

### Running the Application

To start the development server, run the following command inside the `frontend` directory:

```bash
cd backend/scripts
python train_model.py --data-dir ../../datasets/processed_data --out ../models/lstm_weights.pth --epochs 10
```

Output artifact:

1. backend/models/lstm_weights.pth

### 4. Run the backend API locally

```bash
cd backend
python -m uvicorn main_api:app --reload --host 0.0.0.0 --port 8002
```

Backend health endpoint:

```text
GET http://127.0.0.1:8002/health
```

### 4.5 Run with Cloudflare Tunnel (Public URL)

To expose your local FastAPI backend through a public HTTPS URL using Cloudflare Tunnel:

**Option A: Use VS Code compound task (recommended)**

1. Set the tunnel token in PowerShell (one-time per session):

```powershell
$env:CLOUDFLARED_TOKEN = "YOUR_TUNNEL_TOKEN_HERE"
```

Or persist it permanently:

```powershell
setx CLOUDFLARED_TOKEN "YOUR_TUNNEL_TOKEN_HERE"
```

2. In VS Code: Terminal → Run Task → Run API & Tunnel

This opens two integrated terminals: Uvicorn (localhost:8002) and cloudflared.

**Option B: Manual setup (two terminals)**

Terminal 1 (FastAPI):

```powershell
cd backend
python -m uvicorn main_api:app --reload --host 0.0.0.0 --port 8002
```

Terminal 2 (Cloudflared connector):

```powershell
cd backend
.\cloudflared\cloudflared.exe tunnel run --token "YOUR_TUNNEL_TOKEN_HERE"
```

**To obtain your tunnel token:**

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel token stroke-rehab-api
```

**Verify public URL:**

```bash
curl https://api.necookie.dev/health
```

Expected response: `{"status":"ok","service":"stroke-rehab-backend"}`

**Public endpoints:**

- Health: https://api.necookie.dev/health
- Swagger docs: https://api.necookie.dev/docs
- Redoc: https://api.necookie.dev/redoc
- Prediction: https://api.necookie.dev/predict/form (POST)
- Recommendation: https://api.necookie.dev/recommendation (POST)

### 5. Available backend endpoints

1. **GET /health** — Service health check.
2. **POST /predict/form** — Classify pre-extracted pose sequence.
   - Request body: `patient_id`, `exercise_type`, `sequence` (list of frames with 33×3 keypoints).
3. **POST /predict/form-from-video** — Upload video, extract poses, classify form.
   - Form data: `patient_id`, `exercise_type`, `video` file.
4. **POST /recommendation** — Get adaptive exercise recommendations.
   - Request body: `patient_id`, `months_in_recovery`, `latest_form_score` (0.0–1.0), `affected_area` (arms/legs/both), `affected_side` (left/right/both).
   - Response includes `intensity`, `focus`, `details` (sessions_per_week, notes), `confidence`, `model_source`.
   - Note: Stroke type is always ischemic.

## Notes

1. The model files in backend/models are placeholders until you train and save real weights.
2. The recommender loads backend/models/rf_recommender.pkl when available, then falls back to rule-based recommendation.
3. Dataset folders are scaffolded and ready for your train/val/test assets.
