import { useMemo } from 'react';

// Takes the full history array from the store and computes progress stats.
// useMemo makes sure we only recalculate when history actually changes.
//
// Convention (since 2026-06-04): the dashboard's "Overall Progress" cards
// summarize the patient's CURRENT performance, not a lifetime average.
// Earlier we averaged every row in history (~50 sessions), which dragged
// the visible average ~30 points below what the Recent Activity cards
// showed for the same day — older low-scoring attempts were poisoning
// the headline number. We now collapse history to the latest score per
// exercise (the same dedupe rule Recent Activity uses) so the average
// and trend match what the patient sees on screen.
const useOverallProgress = (history) => {
  return useMemo(() => {
    // No data yet — return safe defaults so the card can show a placeholder
    if (!history || history.length === 0) {
      return { overallAverage: 0, exerciseAverages: [], trend: 0, hasData: false };
    }

    // history is newest-first (see usePatientStore.fetchHistory). Bucket
    // by exercise and remember (a) the latest row and (b) the next-most-
    // recent row for trend math.
    const latestByExercise = {};
    const previousByExercise = {};
    history.forEach((item) => {
      const key = item.exercise_id || item.exercise_name;
      if (!key) return;
      if (!latestByExercise[key]) {
        latestByExercise[key] = item;
      } else if (!previousByExercise[key]) {
        previousByExercise[key] = item;
      }
    });

    // Latest per exercise → matches the three cards in Recent Activity,
    // and matches the Session Complete average shown right after a
    // workout. Filter out non-positive scores defensively (the SQL
    // already does .gt('latest_form_score', 0) so this is belt-and-
    // suspenders).
    const latestScores = Object.values(latestByExercise)
      .map((item) => Number(item.latest_form_score))
      .filter((s) => Number.isFinite(s) && s > 0);

    if (latestScores.length === 0) {
      return { overallAverage: 0, exerciseAverages: [], trend: 0, hasData: false };
    }

    const overallAverage = Math.round(
      latestScores.reduce((sum, s) => sum + s, 0) / latestScores.length
    );

    // Per-exercise averages still aggregate ALL of that exercise's
    // history — there's value in seeing your knee-extension lifetime
    // mean even if the headline number tracks recent state.
    const exerciseMap = {};
    history.forEach((item) => {
      const key = item.exercise_id || item.exercise_name;
      if (!key) return;
      if (!exerciseMap[key]) {
        exerciseMap[key] = { name: item.exercise_name, scores: [] };
      }
      const score = Number(item.latest_form_score);
      if (Number.isFinite(score) && score > 0) {
        exerciseMap[key].scores.push(score);
      }
    });

    const exerciseAverages = Object.values(exerciseMap)
      .filter((ex) => ex.scores.length > 0)
      .map((ex) => ({
        name: ex.name,
        average: Math.round(ex.scores.reduce((s, v) => s + v, 0) / ex.scores.length),
        sessions: ex.scores.length,
      }))
      .sort((a, b) => b.average - a.average);

    // Trend: average per-exercise improvement from the previous attempt
    // to the latest. This matches the per-card "+X% better on average"
    // labels in Recent Activity, so the headline trend always agrees
    // with the per-card deltas. Exercises with no prior attempt don't
    // contribute to the trend (no signal to derive).
    const deltas = [];
    Object.keys(latestByExercise).forEach((key) => {
      const latest = Number(latestByExercise[key].latest_form_score);
      const prev = previousByExercise[key] && Number(previousByExercise[key].latest_form_score);
      if (Number.isFinite(latest) && Number.isFinite(prev) && latest > 0 && prev > 0) {
        deltas.push(latest - prev);
      }
    });
    const trend = deltas.length > 0
      ? Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length)
      : 0;

    return { overallAverage, exerciseAverages, trend, hasData: true };
  }, [history]);
};

export default useOverallProgress;
