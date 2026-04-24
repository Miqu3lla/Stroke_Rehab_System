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

### 4. Run the backend API

```bash
cd backend
uvicorn main_api:app --reload
```

Backend health endpoint:

```text
GET http://127.0.0.1:8000/health
```

### 5. Available backend endpoints

1. GET /health
2. POST /predict/form
3. POST /predict/form-from-video
4. POST /recommendation

## Notes

1. The model files in backend/models are placeholders until you train and save real weights.
2. The recommender loads backend/models/rf_recommender.pkl when available, then falls back to rule-based recommendation.
3. Dataset folders are scaffolded and ready for your train/val/test assets.
4. The LSTM training and inference paths are tuned for a Blackwell-class GPU like the RTX 5060 Ti 16GB using `torch==2.11.0+cu128`, AMP autocast, `torch.compile`, `torch.inference_mode`, TF32, cuDNN benchmark mode, pinned-memory loading, and non-blocking transfers.
5. Actual speed still depends on your NVIDIA driver, CUDA runtime, and how much sequence data you feed into the model.