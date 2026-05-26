-- ──────────────────────────────────────────────────────────────────────
-- Security migration: lock down RLS + pin set_updated_at search_path
-- 2026-05-26 — fixes the 7 errors + 1 warning from Supabase's linter.
--
-- WHY: the existing policies use USING (true) with no role scope, which
-- effectively grants unrestricted access to every role (including anon).
-- This migration drops those, then creates per-role policies so:
--   - service_role (backend) keeps unrestricted access
--   - authenticated users can only read their own rows (and a public
--     read of the exercises reference table)
--   - anon (the mobile app's bundled key before login) gets nothing
-- ──────────────────────────────────────────────────────────────────────

-- 1. Drop the existing permissive "Service role unrestricted access"
--    policies. They were misnamed — `USING (true)` with no `TO role`
--    clause applies to every role, not just service_role.
DROP POLICY IF EXISTS "Service role unrestricted access" ON public.patients;
DROP POLICY IF EXISTS "Service role unrestricted access" ON public.recommendation_logs;
DROP POLICY IF EXISTS "Service role unrestricted access" ON public.form_predictions;
DROP POLICY IF EXISTS "Service role unrestricted access" ON public.video_predictions;
DROP POLICY IF EXISTS "Service role unrestricted access" ON public.exercises;

-- 2. Ensure RLS is on for every table the linter flagged. Idempotent —
--    no-op if already enabled, but Supabase's UI lets you disable it
--    after the fact so this re-asserts the desired state.
ALTER TABLE public.patients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_predictions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_predictions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises             ENABLE ROW LEVEL SECURITY;

-- ── patients ─────────────────────────────────────────────────────────
-- Each authenticated user can SELECT/UPDATE only their own row.
-- INSERTs come through the backend (/patients endpoint, service_role).
-- DELETEs are not exposed to authenticated users — only service_role.
CREATE POLICY "patients_self_select" ON public.patients
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "patients_self_update" ON public.patients
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "patients_service_all" ON public.patients
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── recommendation_logs ──────────────────────────────────────────────
-- Read-only for the owning patient (usePatientStore.fetchHistory and
-- SessionSummaryScreen both filter by patient_id). All writes go
-- through the backend.
CREATE POLICY "recommendation_logs_self_select" ON public.recommendation_logs
  FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

CREATE POLICY "recommendation_logs_service_all" ON public.recommendation_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── form_predictions ─────────────────────────────────────────────────
-- Same shape: patient can read their own LSTM verdicts; backend writes.
CREATE POLICY "form_predictions_self_select" ON public.form_predictions
  FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

CREATE POLICY "form_predictions_service_all" ON public.form_predictions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── video_predictions ────────────────────────────────────────────────
CREATE POLICY "video_predictions_self_select" ON public.video_predictions
  FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

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
-- Without a pinned search_path an attacker who can create objects in
-- another schema could shadow NOW() or pg_catalog functions and have
-- this trigger run their code. SET search_path = public, pg_catalog
-- removes the ambiguity.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
