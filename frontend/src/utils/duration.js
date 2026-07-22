// Helpers to format exercise prescription details for display.

// Formats the primary exercise label. The suffix reflects the mode:
//   Functionality → "3 sets × 12 reps · hold 6–12s each"
//   Strength      → "3 sets × 12 reps · 2.5 kg"
// Falls back to duration format if no sets are defined.
export function formatExerciseSession(exercise) {
  const sets = exercise?.sets;
  if (!Array.isArray(sets) || sets.length === 0) {
    // Fallback: show duration estimate if sets data is missing
    return formatExerciseDuration(exercise);
  }

  const repSets = sets.filter((s) => s.format === 'reps');
  if (repSets.length === 0) return formatExerciseDuration(exercise);

  const reps = repSets[0]?.target_reps || 12;
  let label = `${repSets.length} sets × ${reps} reps`;

  // Mode-specific suffix, read from the first rep set (all sets share it).
  const holdPerRep = repSets[0]?.hold_seconds_per_rep;
  const holdMax = repSets[0]?.hold_seconds_max;
  const weightKg = repSets[0]?.target_weight_kg;
  if (holdPerRep) {
    label += ` · hold ${holdPerRep}${holdMax ? `–${holdMax}` : ''}s each`;
  } else if (weightKg != null && Number(weightKg) > 0) {
    label += ` · ${weightKg} kg`;
  }
  return label;
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
