-- Migration: drop patients.name now that first_name + last_name carry
-- the full identity (2026-06-06). Follow-up to supabase_add_first_last_name.sql.
--
-- All readers and writers were already migrated off `name` in code:
--   - backend/routers/patients.py        (insert no longer writes name)
--   - frontend/src/store/usePatientProfileStore.js (select + update use first/last)
--   - frontend/src/store/useAuthStore.js (login onboarding check reads first_name)
--   - frontend/src/components/profile/PatientHeaderProfile.js (composes from first+last)
--   - test_e2e.py                        (uses first_name + last_name)
--
-- Safe to re-run: IF EXISTS guard makes this a no-op on a re-applied
-- migration.

ALTER TABLE public.patients
    DROP COLUMN IF EXISTS name;
