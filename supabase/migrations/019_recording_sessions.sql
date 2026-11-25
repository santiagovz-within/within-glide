BEGIN;

-- Existing sessions remain in Image & Video, including sessions with no messages.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'image-video'
  CHECK (kind IN ('image-video', 'audio'));

CREATE INDEX IF NOT EXISTS chat_sessions_user_kind_updated_idx
  ON public.chat_sessions (user_id, kind, updated_at DESC);

COMMIT;
