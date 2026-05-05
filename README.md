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

## Docker Setup

The project now includes Docker files for both services and a root compose file.

### Build and run

```bash
docker compose up --build
```

### Services and ports

1. Backend API: `http://localhost:8001`
2. Frontend Expo: `http://localhost:8081`

### Notes

1. Backend host port uses `8001` so it does not collide with your local Supabase/cloudflared service on `8000`.
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
   
   Done! Backend runs on `http://localhost:8001` and `https://api.necookie.dev`

**Alternative: Two-terminal setup**
```powershell
# Terminal 1
cd backend
python -m uvicorn main_api:app --host 0.0.0.0 --port 8001

# Terminal 2
cd backend
.\cloudflared\cloudflared.exe tunnel run --token eyJhIjoiNjY4Zjc4YzVhOTU4MWM1MDUxYmQ2MGE0OTg1ZDYxNjYiLCJzIjoiWlRKa1pHVTJaR1l0T0RBNE1DMDBNVFF3TFRreU1UVXRabUV3TUdZME16QXpZV1V6IiwidCI6ImZkM2NlNTE1LTU5MjktNDdiZC1hYTY5LTA1MjczOWY4ZmY1MiJ9

**Test it:**
```powershell
curl http://localhost:8001/health
curl https://api.necookie.dev/health
```

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

### 2. Verify key backend arsenal packages

```bash
python -c "import torch, cv2, mediapipe, sklearn; print('torch:', torch.__version__); print('cuda:', torch.cuda.is_available())"
```

If CUDA is available, the backend LSTM training and inference automatically use GPU.

### 3. Train the LSTM action classifier

Expected data source:

1. Place extracted CSV sequence files in datasets/processed_data.
2. Include a clear naming pattern where files containing the word correct are treated as positive samples.

Run training:

```bash
cd backend/scripts
python train_model.py --data-dir ../../datasets/processed_data --out ../models/lstm_weights.pth --epochs 10
```

Output artifact:

1. backend/models/lstm_weights.pth

### 4. Run the backend API locally

```bash
cd backend
python -m uvicorn main_api:app --reload --host 0.0.0.0 --port 8001
```

Backend health endpoint:

```text
GET http://127.0.0.1:8001/health
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

This opens two integrated terminals: Uvicorn (localhost:8001) and cloudflared.

**Option B: Manual setup (two terminals)**

Terminal 1 (FastAPI):
```powershell
cd backend
python -m uvicorn main_api:app --reload --host 0.0.0.0 --port 8001
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
   - Request body: `patient_id`, `stroke_type` (ischemic/hemorrhagic/tia), `months_in_recovery`, `latest_form_score` (0.0–1.0), `affected_area` (arms/legs/both), `affected_side` (left/right/both).
   - Response includes `intensity`, `focus`, `details` (sessions_per_week, notes), `confidence`, `model_source`.

## Notes

1. The model files in backend/models are placeholders until you train and save real weights.
2. The recommender loads backend/models/rf_recommender.pkl when available, then falls back to rule-based recommendation.
3. Dataset folders are scaffolded and ready for your train/val/test assets.
4. The LSTM training and inference paths are tuned for a Blackwell-class GPU like the RTX 5060 Ti 16GB using `torch==2.11.0+cu128`, AMP autocast, `torch.compile`, `torch.inference_mode`, TF32, cuDNN benchmark mode, pinned-memory loading, and non-blocking transfers.
5. Actual speed still depends on your NVIDIA driver, CUDA runtime, and how much sequence data you feed into the model.