-- Add approval gate for Google OAuth sign-ups.
-- Existing manually-created users and admins are pre-approved.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

-- Every user that already exists was created intentionally by an admin,
-- so retroactively approve them all.
UPDATE public.profiles SET approved = TRUE;
