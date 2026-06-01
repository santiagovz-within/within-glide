-- Key-value store for site-wide configuration (e.g. login background image).
-- Uses service-role key for all writes; the login background key is publicly
-- readable via the /api/settings/login-image endpoint.

CREATE TABLE IF NOT EXISTS public.site_settings (
  key        text        PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated and anonymous users can read all settings
-- (the server still controls which values get exposed via API endpoints).
CREATE POLICY "public_select"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only admins can write (enforced server-side via service role, policy is a belt-and-suspenders guard).
CREATE POLICY "admin_write"
  ON public.site_settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );
