import { create } from 'zustand';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

// Lightweight UUID generator (avoids extra dependency). Good enough as a
// session correlation key for grouping rows in recommendation_logs.
const newSessionId = () => {
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
};

const emptySession = () => ({
  sessionId: null,
  playlist: [],
  currentIndex: 0,
  isResting: false,
  startedAt: null,
  results: [],
  isEndingSession: false,
});

const useSessionStore = create((set, get) => ({
  // ── Session state ───────────────────────────────────────────────────
  // Session lives in the store so the ExerciseScreen, useCamera hook,
  // and SessionSummary screen all read from the same source. The state
  // machine has two visible phases per exercise: active (isResting=false)
  // and rest/transition (isResting=true). See useCamera + ExerciseScreen.
  session: emptySession(),

  // ── Session actions ─────────────────────────────────────────────────

  // Begin a workout session with a playlist of exercises. Optional
  // startIndex lets the patient enter at a specific exercise card
  // (matching the dashboard tap-to-start UX).
  beginSession: (playlist, startIndex = 0) => {
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    const safeIndex = Math.min(Math.max(0, startIndex), playlist.length - 1);
    set({
      session: {
        sessionId: newSessionId(),
        playlist,
        currentIndex: safeIndex,
        isResting: false,
        startedAt: new Date().toISOString(),
        results: [],
      },
    });
  },

  // Save the score for the exercise that just finished and transition to
  // the rest state. endedVia distinguishes 'finish' (timer expired or
  // patient tapped Finish Current) from 'end_early' (Fatigue/Quit).
  // Both earn the partial avg score they accumulated.
  //
  // Idempotent per session_index: if a result for this slot already
  // exists in session.results (e.g. timer auto-finish racing with the
  // user pressing the Finish button), the existing row is replaced in
  // place instead of being appended. This stops duplicate rows from
  // reaching /sessions and skewing the trajectory history.
  saveCurrentScore: ({ avgFormScore, durationSeconds, endedVia = 'finish' }) => {
    const { session } = get();
    if (!session.sessionId) return;
    const current = session.playlist[session.currentIndex];
    if (!current) return;

    const result = {
      recommendation_id: current.id,
      exercise_name: current.name || '',
      exercise_type: current.exercise_type || '',
      session_index: session.currentIndex,
      ended_via: endedVia,
      avg_form_score: Math.max(0, Number(avgFormScore) || 0),
      duration_seconds: Math.max(0, Number(durationSeconds) || 0),
    };

    const existingIndex = session.results.findIndex(
      (r) => r.session_index === session.currentIndex,
    );
    const nextResults = existingIndex >= 0
      ? session.results.map((r, i) => (i === existingIndex ? result : r))
      : [...session.results, result];

    set({
      session: {
        ...session,
        isResting: true,
        results: nextResults,
      },
    });
  },

  // Advance to the next exercise in the playlist. If we just finished
  // the last one, end the session (batch POST + navigate to summary).
  moveToNext: async (navigation) => {
    const { session, endSession } = get();
    if (!session.sessionId) return;

    const nextIndex = session.currentIndex + 1;
    if (nextIndex >= session.playlist.length) {
      await endSession(navigation);
      return;
    }

    set({
      session: {
        ...session,
        currentIndex: nextIndex,
        isResting: false,
      },
    });
  },

  // Flush all buffered results to the backend in one batch POST, then
  // navigate to the summary screen. The session is preserved in store
  // so SessionSummary can read it; the next beginSession resets it.
  endSession: async (navigation) => {
    const { session, isEndingSession } = get();
    if (!session.sessionId || isEndingSession) return;

    set({ isEndingSession: true });

    try {
      const endedAt = new Date().toISOString();
      let saveResult = { ok: false };
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          throw new Error('User not authenticated');
        }
        const response = await instance.post('/sessions', {
          patient_id: user.id,
          session_id: session.sessionId,
          started_at: session.startedAt,
          ended_at: endedAt,
          results: session.results,
        });
        saveResult = { ok: true, data: response.data };
      } catch (error) {
        const detail = error?.response?.data || error.message;
        console.error('Failed to save session:', detail);
        saveResult = { ok: false, detail };
      }

      // Keep session in store so the Summary screen can render results.
      // It will be cleared on the next beginSession() or by clearSession().
      if (navigation) {
        navigation.replace('SessionSummary', { saveResult });
      }
    } finally {
      set({ isEndingSession: false });
    }
  },

  clearSession: () => {
    set({ session: emptySession() });
  },
}));

export default useSessionStore;
