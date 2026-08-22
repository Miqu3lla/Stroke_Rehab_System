import { create } from 'zustand';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';
import { queryClient } from '../lib/queryClient';

// Sets-and-modes feature (Phase B, 2026-06-04): the recommendation
// endpoint now returns TWO variants per request — `functionality`
// (rep-only) and `strength` (rep baseline + 5-min hold finisher on
// unlocked exercises). The store caches both arrays and exposes
// `recommendedExercises` as a derived field pointing at whichever
// variant matches `activeMode`. RecommendationCard and ExerciseModal
// read `recommendedExercises` unchanged — they don't know the toggle
// even exists.

const VALID_MODES = ['functionality', 'strength'];

// Pick the right exercise array out of the variants cache. Falls back
// to functionality (the safe default) when the requested mode isn't
// loaded yet (e.g. before the first /recommendation response lands).
const _resolveExercises = (variants, mode) => {
  if (!variants) return [];
  return variants[mode] || variants.functionality || [];
};

// True when a fresh (non-stale) cache entry already exists for this key —
// used to skip the loading flag so cached data doesn't flash a spinner.
// isStaleByTime (not isStale) because these queries aren't mounted via
// useQuery — an unobserved entry never gets its stale timer ticked, so
// isStale() would report fresh forever. Compare elapsed time directly
// against the configured staleTime instead.
const _isQueryFresh = (queryKey) => {
  const query = queryClient.getQueryCache().find({ queryKey });
  return !!query && !query.isStaleByTime(30_000);
};

const usePatientStore = create((set, get) => ({
  // ── Recommendation state ────────────────────────────────────────────
  // Both variants returned by the backend in one /recommendation call.
  recommendationVariants: { functionality: [], strength: [] },
  // The mode the patient has currently selected. Synced with
  // patients.preferred_mode on load; written back on every toggle.
  activeMode: 'functionality',
  // True once the patient has explicitly toggled the mode in this
  // session (via setActiveMode). loadActiveModeFromProfile skips any
  // override after this flips so a slow profile fetch can't undo a
  // tap that already happened — the user's intent always wins the race.
  activeModeInitialized: false,
  // Derived view of `recommendationVariants[activeMode]`. Held as plain
  // state (not a getter) so Zustand subscribers re-render on swap.
  recommendedExercises: [],
  recommendationLoading: false,
  recommendationError: null,

  // ── History state ───────────────────────────────────────────────────
  history: [],
  historyLoading: false,
  historyError: null,

  // ── Recommendation actions ──────────────────────────────────────────
  // `force` bypasses the cache — used after a session ends, when the
  // recommendation genuinely changed server-side (e.g. exercise unlocks).
  fetchRecommendation: async ({ force = false } = {}) => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }
      const queryKey = ['recommendation', user.id];
      // Skip the loading flag on a cache hit so cached data doesn't flash
      // a spinner — only show loading when we're actually going to fetch.
      if (force || !_isQueryFresh(queryKey)) {
        set({ recommendationLoading: true, recommendationError: null });
      }
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await instance.get(`/recommendation/${user.id}`);
          return response.data || {};
        },
        ...(force && { staleTime: 0 }),
      });

      // Backend sends `functionality.exercises` and `strength.exercises`.
      // Fall back to the legacy top-level `exercises` field for safety
      // during the brief overlap when an older backend is still live.
      const variants = {
        functionality: data.functionality?.exercises || data.exercises || [],
        strength: data.strength?.exercises || data.exercises || [],
      };
      const mode = get().activeMode;
      set({
        recommendationVariants: variants,
        recommendedExercises: _resolveExercises(variants, mode),
      });
    } catch (error) {
      console.error('Failed to fetch recommendation:', error?.response?.data || error.message);
      set({ recommendationError: error.message });
    } finally {
      set({ recommendationLoading: false });
    }
  },

  updateRecommendations: (exercises) => {
    // Legacy helper — directly overrides the active variant's array
    // without touching the mode. Kept for any caller that mutates the
    // recommendation list locally (e.g. after a session completes and
    // updates the on-screen state before refetch).
    const mode = get().activeMode;
    const next = { ...get().recommendationVariants, [mode]: exercises || [] };
    set({
      recommendationVariants: next,
      recommendedExercises: exercises || [],
    });
  },

  // Switch which variant is displayed. Updates the derived
  // `recommendedExercises` immediately so cards swap with zero latency,
  // then persists the choice to `patients.preferred_mode` so the next
  // session starts on the same mode.
  setActiveMode: async (mode) => {
    if (!VALID_MODES.includes(mode)) return;
    if (get().activeMode === mode) {
      // No state swap needed, but if this is the user's first tap we
      // still need to lock the mode in so a late loadActiveModeFromProfile
      // can't override their intent. Without this, tapping the already-
      // selected mode looks like a no-op but actually leaves the door
      // open for the stored profile value to flip it later.
      if (!get().activeModeInitialized) set({ activeModeInitialized: true });
      return;
    }
    set({
      activeMode: mode,
      activeModeInitialized: true,
      recommendedExercises: _resolveExercises(get().recommendationVariants, mode),
    });
    // Fire-and-forget persistence — UI doesn't block on the network.
    // Worst case the next session reloads to the previous mode; the
    // patient can just re-toggle.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('patients')
        .update({ preferred_mode: mode })
        .eq('id', user.id);
      if (error) {
        console.log('Persist preferred_mode failed:', error.message);
      }
    } catch (e) {
      console.log('Persist preferred_mode failed:', e?.message || e);
    }
  },

  // Restore the patient's last-chosen mode from their profile when
  // the Sessions tab mounts. Called in parallel with fetchRecommendation
  // — both update derived state, so order of completion doesn't matter.
  loadActiveModeFromProfile: async () => {
    try {
      // If the patient has already tapped the toggle in this session,
      // their intent wins — never overwrite it with the stored profile
      // value. The race: setActiveMode + loadActiveModeFromProfile run
      // in parallel from the Sessions screen, and a slow Supabase query
      // would otherwise undo a fast tap.
      if (get().activeModeInitialized) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('patients')
        .select('preferred_mode')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.log('Load preferred_mode failed:', error.message);
        return;
      }
      // Re-check after the await — the user may have tapped during the
      // network round-trip.
      if (get().activeModeInitialized) return;
      const mode = data?.preferred_mode;
      if (VALID_MODES.includes(mode) && mode !== get().activeMode) {
        set({
          activeMode: mode,
          activeModeInitialized: true,
          recommendedExercises: _resolveExercises(get().recommendationVariants, mode),
        });
      } else {
        set({ activeModeInitialized: true });
      }
    } catch (e) {
      console.log('Load preferred_mode failed:', e?.message || e);
    }
  },

  fetchHistory: async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }

      const queryKey = ['history', user.id];
      // Skip the loading flag on a cache hit so cached data doesn't flash
      // a spinner — only show loading when we're actually going to fetch.
      if (!_isQueryFresh(queryKey)) {
        set({ historyLoading: true, historyError: null });
      }

      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const { data, error } = await supabase
            .from('recommendation_logs')
            .select('id, latest_form_score, recommendation, created_at')
            .eq('patient_id', user.id)
            .gt('latest_form_score', 0)
            .order('created_at', { ascending: false })
            .limit(50);
          if (error) throw error;
          return data;
        },
      });

      const history = data.map(row => ({
        id: row.id,
        latest_form_score: row.latest_form_score,
        exercise_id: row.recommendation?.recommendation_id,
        exercise_name: row.recommendation?.exercise_name || 'Exercise',
        created_at: row.created_at,
      }));

      set({ history });
    } catch (error) {
      console.error('Failed to fetch history from supabase:', error.message);
      set({ historyError: error.message });
    } finally {
      set({ historyLoading: false });
    }
  },

}));

export default usePatientStore;
