-- Figma plugin integration: shared link token + GIF transfer queue

-- ── Token columns on profiles ──────────────────────────────────────────────
-- figma_token_hash   : SHA-256 of the raw token (never stored in plain)
-- figma_token_prefix : first 8 chars of the raw token, shown in the UI for
--                      the user to verify they have the right token without
--                      exposing the secret.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS figma_token_hash   text,
  ADD COLUMN IF NOT EXISTS figma_token_prefix varchar(8);

-- Index so the plugin-auth lookup (hash → user) stays O(log n).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_figma_token_hash_idx
  ON public.profiles (figma_token_hash)
  WHERE figma_token_hash IS NOT NULL;

-- ── Figma transfer queue ───────────────────────────────────────────────────
-- Each row is one GIF the user staged to send to their open Figma file.
-- status lifecycle: 'uploading' → 'pending' → 'consumed'
--   uploading : stage endpoint created the row; GCS upload in progress
--   pending   : upload confirmed; plugin hasn't picked it up yet
--   consumed  : plugin placed the GIF into Figma; terminal state

CREATE TABLE IF NOT EXISTS public.figma_transfers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gcs_ref     text        NOT NULL,        -- 'gcs:figma-transfers/<user>/<id>.gif'
  width       integer,                     -- actual GIF pixel width (hint for plugin)
  height      integer,                     -- actual GIF pixel height (hint for plugin)
  size_bytes  integer,
  status      text        NOT NULL DEFAULT 'uploading'
                          CHECK (status IN ('uploading', 'pending', 'consumed')),
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,        -- 1 h TTL; stale rows are simply ignored
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Partial index: the plugin's "latest pending" query filters on these three columns.
CREATE INDEX IF NOT EXISTS figma_transfers_user_pending_idx
  ON public.figma_transfers (user_id, expires_at DESC)
  WHERE status = 'pending';

-- All API access goes through the service-role key; block direct client access.
ALTER TABLE public.figma_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_direct_client_access"
  ON public.figma_transfers
  USING (false)
  WITH CHECK (false);
