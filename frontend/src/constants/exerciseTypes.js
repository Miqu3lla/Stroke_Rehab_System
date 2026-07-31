export const EXERCISE_TYPES = {
  SHOULDER_FLEXION: "shoulder_flexion",
  HAND_TO_MOUTH: "hand_to_mouth",
  KNEE_EXTENSION: "knee_extension",
  SIT_TO_STAND: "sit_to_stand",
};

// Exercises for which the backend LSTM (StrokeLSTMClassifier) was trained.
// Kept in sync with backend/core/exercise_catalog.py:LSTM_SUPPORTED_EXERCISE_TYPES.
// Frontend uses this to decide whether to fire the post-session sequence
// to /predict/form — skipping the call for unsupported exercises avoids
// writing meaningless out-of-distribution verdicts to form_predictions.
// 2026-07-30: arm_raise retired (swapped for hand_to_mouth). Per-exercise
// models added for shoulder_flexion + hand_to_mouth; sit_to_stand uses the
// global model. knee_extension dropped — its model never clears ~46% (a data
// issue), so it falls back to the live joint-angle score. Keep in sync with
// backend/core/exercise_catalog.py:LSTM_SUPPORTED_EXERCISE_TYPES.
export const LSTM_SUPPORTED_EXERCISE_TYPES = new Set([
  "shoulder_flexion",
  "hand_to_mouth",
  "sit_to_stand",
]);

export const isLstmSupported = (exerciseType) =>
  LSTM_SUPPORTED_EXERCISE_TYPES.has(String(exerciseType || "").toLowerCase());
