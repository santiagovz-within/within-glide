-- Add is_admin column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow all authenticated users to read template (base) flows
-- (run this only if you have RLS enabled on the flows table)
-- CREATE POLICY "All users can read base flows"
--   ON public.flows FOR SELECT
--   USING (is_template = true);

-- Seed the first registered user as admin (run once, then disable)
-- UPDATE public.profiles
--   SET is_admin = TRUE
--   WHERE created_at = (SELECT MIN(created_at) FROM public.profiles);
