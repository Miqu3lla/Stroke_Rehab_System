// Helpers to format exercise prescription details for display.

// Formats the primary exercise label (e.g., "3 sets × 12 reps + 5-min hold").
// Falls back to duration format if no sets are defined.
export function formatExerciseSession(exercise) {
  const sets = exercise?.sets;
  if (!Array.isArray(sets) || sets.length === 0) {
    // Fallback: show duration estimate if sets data is missing
    return formatExerciseDuration(exercise);
  }

  const repSets = sets.filter((s) => s.format === 'reps');
  const holdSets = sets.filter((s) => s.format === 'hold');

  const parts = [];
  if (repSets.length > 0) {
    const reps = repSets[0]?.target_reps || 12;
    parts.push(`${repSets.length} sets × ${reps} reps`);
  }
  if (holdSets.length > 0) {
    const seconds = holdSets[0]?.hold_seconds || 0;
    const minutes = Math.round(seconds / 60);
    parts.push(`${minutes}-min hold`);
  }
  if (parts.length === 0) return formatExerciseDuration(exercise);
  return parts.join(' + ');
}

// Formats the exercise duration as a readable time estimate (e.g., "2 min", "45s", "2 min 30s").
export function formatExerciseDuration(exercise) {
  if (!exercise) return '';
  const totalSeconds = Number(exercise.duration_seconds)
    || (Number(exercise.duration_minutes) || 0) * 60;
  if (!totalSeconds) return '';

  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);

  // Exact minutes (e.g., "2 min")
  if (secs === 0) return `${mins} min`;
  // Less than a minute (e.g., "45s")
  if (mins === 0) return `${secs}s`;
  // Minutes and seconds (e.g., "2 min 30s")
  return `${mins} min ${secs}s`;
}
