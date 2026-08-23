import { useMemo } from 'react';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Local calendar-date key (not toISOString, which is UTC and would shift
// the day backwards for any positive UTC offset, e.g. Asia/Manila).
const localDateKey = (date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Buckets real history rows (from usePatientStore.fetchHistory, Supabase
// recommendation_logs) into the last 7 calendar days for the daily chart.
const useWeeklyScores = (history) => {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Scaffold today-6..today so empty days still get a bar slot.
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      return { key: localDateKey(d), label: DAY_LETTERS[d.getDay()], scores: [] };
    });
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));

    // Drop each real session into its calendar-day bucket.
    (history || []).forEach((item) => {
      if (!item.created_at) return;
      const key = localDateKey(new Date(item.created_at));
      const bucket = byKey[key];
      const score = Number(item.latest_form_score);
      if (bucket && Number.isFinite(score) && score > 0) {
        bucket.scores.push(score);
      }
    });

    // Average same-day sessions; null (no bar height) when a day is empty.
    return days.map(({ key, label, scores }) => ({
      key,
      label,
      average: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    }));
  }, [history]);
};

export default useWeeklyScores;
