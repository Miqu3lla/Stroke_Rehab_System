# Stroke Rehab System

Mobile-Based Computer Vision and Machine Learning application for stroke rehabilitation.

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
   ```

3. Install the necessary dependencies:
   ```bash
   npm install
   ```

### Running the Application

To start the development server, run the following command inside the `frontend` directory:

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
