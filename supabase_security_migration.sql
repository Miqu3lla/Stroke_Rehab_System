-- ──────────────────────────────────────────────────────────────────────
-- Security + Performance migration for RLS
-- 2026-05-26 — last updated for the Performance Advisor warnings.
--
-- Fixes the 7 Security errors + 1 warning AND the 8 Performance
-- warnings Supabase's linter raises.
--
-- WHY (security): the original schema's policies used USING (true) with
-- no role scope, so every role (including anon) got unrestricted access.
-- WHY (performance): RLS policies that call auth.uid() bare get
-- re-evaluated for every row in a query. Wrapping the call as
-- (SELECT auth.uid()) turns it into an initPlan that runs once per
-- query. Multiple permissive policies on the same role+action are
-- evaluated together (OR), so we keep at most one per role per action.
-- ──────────────────────────────────────────────────────────────────────

-- 1. Wipe ALL existing policies on the affected tables. Doing it
--    defensively (rather than DROP IF EXISTS by name) catches leftover
--    policies from the original schema, prior migrations, or anything
--    added via the Supabase UI. We're about to recreate the canonical
--    set below, so this is safe.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'patients',
        'recommendation_logs',
        'form_predictions',
        'video_predictions',
        'exercises'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;

-- 2. Ensure RLS is enabled. Idempotent.
ALTER TABLE public.patients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_predictions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_predictions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises             ENABLE ROW LEVEL SECURITY;

-- ── patients ─────────────────────────────────────────────────────────
-- Each authenticated user can SELECT/UPDATE only their own row.
-- INSERTs come through the backend (/patients endpoint, service_role).
-- DELETEs are not exposed to authenticated users.
--
-- Note (SELECT auth.uid()) instead of auth.uid() — the subquery form is
-- evaluated once per query (initPlan) instead of once per row.
CREATE POLICY "patients_self_select" ON public.patients
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "patients_self_update" ON public.patients
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "patients_service_all" ON public.patients
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── recommendation_logs ──────────────────────────────────────────────
-- Read-only for the owning patient (usePatientStore.fetchHistory and
-- SessionSummaryScreen both filter by patient_id). All writes go
-- through the backend.
CREATE POLICY "recommendation_logs_self_select" ON public.recommendation_logs
  FOR SELECT TO authenticated
  USING (patient_id = (SELECT auth.uid()));

CREATE POLICY "recommendation_logs_service_all" ON public.recommendation_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── form_predictions ─────────────────────────────────────────────────
-- Patient can read their own LSTM verdicts; backend writes.
CREATE POLICY "form_predictions_self_select" ON public.form_predictions
  FOR SELECT TO authenticated
  USING (patient_id = (SELECT auth.uid()));

CREATE POLICY "form_predictions_service_all" ON public.form_predictions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── video_predictions ────────────────────────────────────────────────
CREATE POLICY "video_predictions_self_select" ON public.video_predictions
  FOR SELECT TO authenticated
  USING (patient_id = (SELECT auth.uid()));

CREATE POLICY "video_predictions_service_all" ON public.video_predictions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── exercises ────────────────────────────────────────────────────────
-- Reference data — no PII, every authenticated user can read.
-- Only the backend writes (catalog seeds / future admin updates).
CREATE POLICY "exercises_authenticated_read" ON public.exercises
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "exercises_service_all" ON public.exercises
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── set_updated_at trigger function ──────────────────────────────────
-- Two layers of defense against now()/pg_catalog shadowing:
--   1. search_path puts pg_catalog FIRST so a user-defined public.now()
--      can't win lookup. (The earlier `public, pg_catalog` order let an
--      attacker who could create objects in public shadow the real now.)
--   2. CURRENT_TIMESTAMP is a SQL reserved keyword — it isn't resolved
--      through search_path at all, so it can't be hijacked regardless.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
