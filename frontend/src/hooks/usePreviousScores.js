import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

// Fetches each exercise's most recent PRIOR score, keyed by recommendation_id,
// so SessionSummaryScreen can show "up from X" comparisons. Only fires once a
// sessionId exists (there's nothing to compare against before that).
const usePreviousScores = (sessionId) => {
  const [previousScores, setPreviousScores] = useState({});

  useEffect(() => {
    const fetchPreviousScores = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('recommendation_logs')
          .select('latest_form_score, recommendation, created_at')
          .eq('patient_id', user.id)
          .gt('latest_form_score', 0)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const prev = {};
        for (const row of data) {
          const rec = row.recommendation;
          if (!rec) continue;

          // Skip the session we literally just completed
          if (rec.session_id === sessionId) continue;

          const exId = rec.recommendation_id;
          if (exId && prev[exId] === undefined) {
            prev[exId] = row.latest_form_score;
          }
        }
        setPreviousScores(prev);
      } catch (err) {
        console.error("Failed to fetch previous scores:", err);
      }
    };

    if (sessionId) {
      fetchPreviousScores();
    }
  }, [sessionId]);

  return { previousScores };
};

export default usePreviousScores;
