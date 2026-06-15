-- Migration: split patients.name into first_name + last_name
-- (2026-06-06). Therapist dashboard (planned) wants first-name greetings
-- and last-name sorting; the single `name` column can't do either
-- without parsing on every read.
--
-- Strategy:
--   1. Add `first_name` + `last_name` columns (nullable so existing
--      rows aren't rejected by a NOT NULL).
--   2. Backfill from the existing `name` field — split on the FIRST
--      space. `John Doe` → first=John, last=Doe. `Madonna` (one word)
--      → first=Madonna, last=''. Single-name patients keep working.
--   3. Keep the `name` column for now as a denormalized "full name"
--      cache that the backend insert keeps in sync. Any legacy reader
--      not yet migrated still works; new readers prefer first/last.
--      Drop in a follow-up migration once we're sure nothing reads
--      `name` directly.
--
-- Safe to re-run.

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Backfill from the legacy `name` column. Only touches rows where the
-- new columns are still null so re-runs don't clobber edits made after
-- the first migration.
UPDATE public.patients
SET
    first_name = COALESCE(first_name, split_part(name, ' ', 1)),
    last_name  = COALESCE(
        last_name,
        NULLIF(substring(name FROM position(' ' IN name) + 1), name)
    )
WHERE name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Single-word names (e.g. "Madonna") have no space, so the substring
-- above returns the same string back; the NULLIF flips it to NULL so
-- last_name stays empty rather than duplicating first_name.
