// Display helpers for the recommender's per-exercise prescription.
//
// Phase C (sets-and-modes, 2026-06-04) shifted what cards should show.
// The old "X min" label was the continuous-timer length; in sets-mode
// it's the worst-case "if patient hits cap on every set" estimate,
// which is misleading. Cards should now display the sets composition
// (e.g. "3 sets × 12 reps") as the primary label, since that's the
// commitment the patient is actually signing up for. formatExerciseDuration
// stays for the rare case where a caller still needs the time estimate.

// Primary card label — describes the work the patient is going to do.
// For Strength mode with the hold finisher unlocked, this surfaces the
// extra commitment ("3 sets × 12 reps + 5-min hold finisher") so the
// patient isn't surprised mid-session.
export function formatExerciseSession(exercise) {
  const sets = exercise?.sets;
  if (!Array.isArray(sets) || sets.length === 0) {
    // Fallback: old recommender shapes that don't carry sets — show
    // the time estimate so the card never goes blank.
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

// Time-based label retained for any caller that wants the worst-case
// projection. Phase B's cards consumed this; Phase C's cards prefer
// formatExerciseSession.
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
