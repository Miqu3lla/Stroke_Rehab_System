-- ──────────────────────────────────────────────────────────────────────
-- Supabase health check — run section-by-section in the SQL Editor.
-- Highlight one block, press Cmd/Ctrl+Enter, screenshot/paste the
-- result, then repeat. Each section answers a specific "is this set
-- up correctly?" question for the Stroke_Rehab_System project.
-- ──────────────────────────────────────────────────────────────────────


-- ── §1. Tables exist + RLS enabled ───────────────────────────────────
-- Expect: 5 rows, rowsecurity = true for every one.
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'patients', 'recommendation_logs',
    'form_predictions', 'video_predictions', 'exercises'
  )
ORDER BY tablename;


-- ── §2. RLS policies (security + perf check) ─────────────────────────
-- Expect for each table:
--   - one "..._self_select" (or _read) policy scoped TO authenticated
--   - one "..._service_all" policy scoped TO service_role
--   - patients also has _self_update
--   - USING clauses use (SELECT auth.uid()) NOT bare auth.uid()
--   - no leftover "Service role unrestricted access" policy
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd AS action,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'patients', 'recommendation_logs',
    'form_predictions', 'video_predictions', 'exercises'
  )
ORDER BY tablename, policyname;


-- ── §3. Indexes (post-cleanup check) ─────────────────────────────────
-- Expect to see:
--   - patients_pkey
--   - recommendation_logs_pkey + recommendation_logs_patient_id_idx
--     + recommendation_logs_created_at_idx
--   - form_predictions_pkey + form_predictions_patient_id_idx (kept FK idx)
--   - video_predictions_pkey + video_predictions_patient_id_idx
--   - exercises_pkey + exercises_exercise_type_key (UNIQUE constraint)
-- Should NOT see: patients_name_idx, patients_stroke_type_idx,
--   patients_created_at_idx, form_predictions_created_at_idx,
--   video_predictions_created_at_idx (dropped in cleanup migration).
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'patients', 'recommendation_logs',
    'form_predictions', 'video_predictions', 'exercises'
  )
ORDER BY tablename, indexname;


-- ── §4. set_updated_at function definition ───────────────────────────
-- Expect: language plpgsql, prosrc body uses CURRENT_TIMESTAMP (not NOW),
-- proconfig contains 'search_path=pg_catalog, public' (pg_catalog first).
SELECT
  proname,
  prolang::regtype AS lang,
  proconfig AS function_settings,
  prosrc AS body
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'set_updated_at';


-- ── §5. updated_at triggers are still attached ───────────────────────
-- Expect 4 rows — one trg_<table>_updated_at per table that has an
-- updated_at column (patients, recommendation_logs, form_predictions,
-- video_predictions). Confirms the policy work didn't drop triggers.
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND trigger_name LIKE 'trg_%_updated_at'
ORDER BY event_object_table;


-- ── §6. exercises catalog is seeded with the 4 active exercises ──────
-- Expect 4 rows: shoulder_flexion (arms), arm_raise (arms),
-- knee_extension (legs), sit_to_stand (legs). body_area must match
-- the values the recommender filters by ('arms' / 'legs', NOT
-- 'upper_limb' / 'lower_limb').
SELECT
  exercise_type,
  display_name,
  body_area,
  description
FROM public.exercises
ORDER BY body_area, exercise_type;


-- ── §7. Row counts per table ─────────────────────────────────────────
-- Quick sanity on data presence. Anything unexpectedly empty is a
-- pipeline issue, anything unexpectedly huge is a leak.
SELECT 'patients'             AS table_name, COUNT(*) AS row_count FROM public.patients
UNION ALL
SELECT 'recommendation_logs',  COUNT(*) FROM public.recommendation_logs
UNION ALL
SELECT 'form_predictions',     COUNT(*) FROM public.form_predictions
UNION ALL
SELECT 'video_predictions',    COUNT(*) FROM public.video_predictions
UNION ALL
SELECT 'exercises',            COUNT(*) FROM public.exercises;


-- ── §8. Foreign keys + delete-cascade behavior ───────────────────────
-- Expect ON DELETE CASCADE from every child table back to patients(id),
-- so deleting a patient cleans up their sessions/predictions.
SELECT
  tc.table_name AS child_table,
  kcu.column_name AS child_column,
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;


-- ── §9. Most recent activity (smoke test that backend writes work) ───
-- Should show non-null timestamps if the backend has been hit recently.
SELECT
  'patients_latest_created'     AS event, MAX(created_at) AS at FROM public.patients
UNION ALL
SELECT 'recommendation_latest',   MAX(created_at) FROM public.recommendation_logs
UNION ALL
SELECT 'form_prediction_latest',  MAX(created_at) FROM public.form_predictions
UNION ALL
SELECT 'video_prediction_latest', MAX(created_at) FROM public.video_predictions;
