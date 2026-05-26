-- ──────────────────────────────────────────────────────────────────────
-- Drop unused indexes — clears 5 of the 7 INFO suggestions from the
-- Performance Advisor. 2026-05-26.
--
-- Each of these has times_used = 0 in pg_stat_user_indexes and serves
-- no query path. They cost write performance + storage for no read
-- benefit. Easy to recreate if a future query pattern needs them.
--
-- PRESERVED on purpose (FK indexes — will pay off once those flows activate):
--   - form_predictions_patient_id_idx (trajectory analyzer will hit this)
--   - video_predictions_patient_id_idx (dormant video flow)
--   - patients_pkey, form_predictions_pkey, video_predictions_pkey (PKs)
--
-- The Performance Advisor will still flag those two FK indexes until
-- they get traffic — that's expected and acceptable as a deliberate trade.
-- ──────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.form_predictions_created_at_idx;
DROP INDEX IF EXISTS public.patients_created_at_idx;
DROP INDEX IF EXISTS public.patients_name_idx;
DROP INDEX IF EXISTS public.patients_stroke_type_idx;
DROP INDEX IF EXISTS public.video_predictions_created_at_idx;
