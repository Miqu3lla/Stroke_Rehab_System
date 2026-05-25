import { useMemo } from 'react';

const useOverallProgress = (history) => {
  return useMemo(() => {
    if (!history || history.length === 0) {
      return { overallAverage: 0, exerciseAverages: [], trend: 0, hasData: false };
    }

    const overallAverage = Math.round(
      history.reduce((sum, item) => sum + (Number(item.latest_form_score) || 0), 0) / history.length
    );

    // Group scores by exercise
    const exerciseMap = {};
    history.forEach((item) => {
      const key = item.exercise_id || item.exercise_name;
      if (!exerciseMap[key]) {
        exerciseMap[key] = { name: item.exercise_name, scores: [] };
      }
      exerciseMap[key].scores.push(Number(item.latest_form_score) || 0);
    });

    const exerciseAverages = Object.values(exerciseMap)
      .map((ex) => ({
        name: ex.name,
        average: Math.round(ex.scores.reduce((s, v) => s + v, 0) / ex.scores.length),
        sessions: ex.scores.length,
      }))
      .sort((a, b) => b.average - a.average);

    // Trend: compare recent half vs older half (history is already ordered desc by date)
    let trend = 0;
    if (history.length >= 4) {
      const half = Math.floor(history.length / 2);
      const recentAvg =
        history.slice(0, half).reduce((s, i) => s + (Number(i.latest_form_score) || 0), 0) / half;
      const olderAvg =
        history.slice(half).reduce((s, i) => s + (Number(i.latest_form_score) || 0), 0) /
        (history.length - half);
      trend = Math.round(recentAvg - olderAvg);
    }

    return { overallAverage, exerciseAverages, trend, hasData: true };
  }, [history]);
};

export default useOverallProgress;
