-- Add thumbnail_url to chat_sessions for the session list sidebar preview.
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS thumbnail_url text;
