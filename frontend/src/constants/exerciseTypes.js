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
// 2026-07-30: arm_raise retired (swapped for hand_to_mouth). All four
// exercises now have per-exercise models (2026-08-11: sit_to_stand got its
// own model; knee_extension is a hybrid — pooled LSTM + geometric veto, see
// backend/core/neural_network.py). Keep in sync with
// backend/core/exercise_catalog.py:LSTM_SUPPORTED_EXERCISE_TYPES.
export const LSTM_SUPPORTED_EXERCISE_TYPES = new Set([
  "shoulder_flexion",
  "hand_to_mouth",
  "sit_to_stand",
  "knee_extension",
]);

export const isLstmSupported = (exerciseType) =>
  LSTM_SUPPORTED_EXERCISE_TYPES.has(String(exerciseType || "").toLowerCase());
