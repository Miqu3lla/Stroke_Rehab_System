-- Migration: add patients.preferred_mode for the Functionality/Strength
-- session-mode toggle (sets-and-modes feature, Phase A, 2026-06-04).
--
-- Functionality = patient does rep-only sets (3 sets × 12 reps).
-- Strength      = same rep baseline, plus a 5-min hold finisher per
--                 exercise once the patient unlocks it through repeated
--                 ≥85% sessions and >+30% improvement vs baseline.
--
-- The column is patient-level (not session-level) because clinically a
-- patient is prescribed one mode at a time — they don't bounce between
-- functional training and strength training on the same week. The
-- frontend toggles it via PATCH whenever the patient changes their mind.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + a guarded CHECK constraint.

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS preferred_mode TEXT NOT NULL DEFAULT 'functionality';

-- Constraint dropped-then-added so re-running this migration doesn't
-- accumulate duplicate constraints. The DO block is just to silence the
-- "constraint does not exist" error on the first run.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'patients_preferred_mode_check'
          AND conrelid = 'public.patients'::regclass
    ) THEN
        ALTER TABLE public.patients DROP CONSTRAINT patients_preferred_mode_check;
    END IF;
END $$;

ALTER TABLE public.patients
    ADD CONSTRAINT patients_preferred_mode_check
    CHECK (preferred_mode IN ('functionality', 'strength'));
