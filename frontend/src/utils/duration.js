// Display helper for the recommender's per-exercise duration. The
// recommender now returns `duration_seconds` (precise — after the
// trajectory upgrade/downgrade multiplier) alongside `duration_minutes`
// (rounded for legacy callers). Cards should prefer the precise value so
// a +15% improvement actually shows up to the patient instead of
// silently rounding back to the base label.
export function formatExerciseDuration(exercise) {
  if (!exercise) return '';
  const totalSeconds = Number(exercise.duration_seconds)
    || (Number(exercise.duration_minutes) || 0) * 60;
  if (!totalSeconds) return '';

  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);

  // No partial seconds → keep the compact "2 min" label so the existing
  // dashboard layout doesn't shift for unchanged exercises.
  if (secs === 0) return `${mins} min`;
  // Sub-minute case (e.g. downgrade on a 1-min base) — show seconds only.
  if (mins === 0) return `${secs}s`;
  return `${mins} min ${secs}s`;
}
