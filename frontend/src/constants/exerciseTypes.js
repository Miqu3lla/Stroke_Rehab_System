export const EXERCISE_TYPES = {
  SHOULDER_FLEXION: "shoulder_flexion",
  ARM_RAISE: "arm_raise",
  KNEE_EXTENSION: "knee_extension",
  SIT_TO_STAND: "sit_to_stand",
};

// Exercises for which the backend LSTM (StrokeLSTMClassifier) was trained.
// Kept in sync with backend/core/exercise_catalog.py:LSTM_SUPPORTED_EXERCISE_TYPES.
// Frontend uses this to decide whether to fire the post-session sequence
// to /predict/form — skipping the call for shoulder_flexion avoids
// writing meaningless out-of-distribution verdicts to form_predictions.
export const LSTM_SUPPORTED_EXERCISE_TYPES = new Set([
  "arm_raise",
  "knee_extension",
  "sit_to_stand",
]);

export const isLstmSupported = (exerciseType) =>
  LSTM_SUPPORTED_EXERCISE_TYPES.has(String(exerciseType || "").toLowerCase());
