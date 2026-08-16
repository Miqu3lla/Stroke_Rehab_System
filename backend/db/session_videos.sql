-- Session evidence video capture (Option A).
--
-- One short clip per exercise, captured from the /ws/pose frame stream
-- (see backend/core/session_video.py). Stored in the private
-- 'session-evidence' Storage bucket; this table is the index the PT
-- dashboard queries to find a session's clips and mint signed URLs.
--
-- Retention: the backend keeps only the CURRENT session's clips per
-- patient (it purges rows + objects from older sessions when a new
-- session's first clip lands). Run this file once against the
-- self-hosted Supabase Postgres.

CREATE TABLE IF NOT EXISTS public.session_videos (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id       uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    -- session_id mirrors the pseudo-UUID the mobile client generates per
    -- workout (same value stored inside recommendation_logs.recommendation).
    -- text, not uuid, because it is a client-side correlation key, not a
    -- DB-issued id.
    session_id       text NOT NULL,
    exercise_type    text NOT NULL DEFAULT '',
    -- Path inside the 'session-evidence' bucket:
    --   {patient_id}/{session_id}/{exercise_type}.mp4
    storage_path     text NOT NULL,
    duration_seconds real NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- The dashboard fetches a session's clips by (patient_id, session_id);
-- the retention purge deletes by patient_id + session_id <> current.
CREATE INDEX IF NOT EXISTS session_videos_patient_session_idx
    ON public.session_videos (patient_id, session_id);

-- One row per exercise per session. The backend upserts on this key so a
-- re-record (e.g. a WS reconnect for the same exercise) UPDATES the row
-- instead of duplicating it — matching the x-upsert overwrite of the
-- Storage object at the same path.
CREATE UNIQUE INDEX IF NOT EXISTS session_videos_patient_session_exercise_key
    ON public.session_videos (patient_id, session_id, exercise_type);

-- Private bucket — clips are only reachable via short-lived signed URLs
-- the PT dashboard mints with the service role. public=false keeps them
-- off any anonymous public URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('session-evidence', 'session-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- RLS. Table holds real patient session data and is reachable via
-- PostgREST — a plain CREATE TABLE defaults to RLS off, which silently
-- re-exposes every patient's clips to anyone with the anon key if this
-- file is ever rerun after a drop/recreate (that happened once already;
-- this block exists so it can't happen silently again). Idempotent: safe
-- to rerun against a table that already has these policies.
ALTER TABLE public.session_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_videos_self_select ON public.session_videos;
CREATE POLICY session_videos_self_select
    ON public.session_videos
    FOR SELECT
    TO authenticated
    USING (patient_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS session_videos_service_all ON public.session_videos;
CREATE POLICY session_videos_service_all
    ON public.session_videos
    TO service_role
    USING (true)
    WITH CHECK (true);
