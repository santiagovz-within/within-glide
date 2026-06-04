-- Mark users as test users with restricted canvas access (Video Input + Video to GIF only).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test_user BOOLEAN NOT NULL DEFAULT FALSE;
