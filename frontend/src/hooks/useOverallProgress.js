import { useMemo } from 'react';

// Takes the full history array from the store and computes progress stats.
// useMemo makes sure we only recalculate when history actually changes.
const useOverallProgress = (history) => {
  return useMemo(() => {
    // No data yet — return safe defaults so the card can show a placeholder
    if (!history || history.length === 0) {
      return { overallAverage: 0, exerciseAverages: [], trend: 0, hasData: false };
    }

    // Add up all scores and divide by the number of sessions to get one overall number
    const overallAverage = Math.round(
      history.reduce((sum, item) => sum + (Number(item.latest_form_score) || 0), 0) / history.length
    );

    // Build a map so each exercise collects all of its own scores together
    const exerciseMap = {};
    history.forEach((item) => {
      const key = item.exercise_id || item.exercise_name;
      if (!exerciseMap[key]) {
        exerciseMap[key] = { name: item.exercise_name, scores: [] };
      }
      exerciseMap[key].scores.push(Number(item.latest_form_score) || 0);
    });

    // Convert the map into an array, compute each exercise's average,
    // then sort highest score first so the best-performing exercise appears at the top
    const exerciseAverages = Object.values(exerciseMap)
      .map((ex) => ({
        name: ex.name,
        average: Math.round(ex.scores.reduce((s, v) => s + v, 0) / ex.scores.length),
        sessions: ex.scores.length,
      }))
      .sort((a, b) => b.average - a.average);

    // Trend: split history into two halves (history comes in newest-first order).
    // If the recent half scores higher than the older half, the patient is improving.
    // We need at least 4 entries to make a meaningful comparison.
    let trend = 0;
    if (history.length >= 4) {
      const half = Math.floor(history.length / 2);
      const recentAvg =
        history.slice(0, half).reduce((s, i) => s + (Number(i.latest_form_score) || 0), 0) / half;
      const olderAvg =
        history.slice(half).reduce((s, i) => s + (Number(i.latest_form_score) || 0), 0) /
        (history.length - half);
      // Positive = improving, negative = declining, 0 = no change
      trend = Math.round(recentAvg - olderAvg);
    }

    return { overallAverage, exerciseAverages, trend, hasData: true };
  }, [history]);
};

export default useOverallProgress;
