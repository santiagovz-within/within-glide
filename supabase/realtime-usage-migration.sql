-- Run this in the Supabase SQL editor (Database → SQL Editor)

CREATE TABLE IF NOT EXISTS realtime_usage (
  user_id       uuid           NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date    date           NOT NULL DEFAULT CURRENT_DATE,
  cost_usd      numeric(12, 8) NOT NULL DEFAULT 0,
  request_count integer        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS realtime_usage_user_id_idx ON realtime_usage(user_id);

-- RLS
ALTER TABLE realtime_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own rows
CREATE POLICY "realtime_usage_select" ON realtime_usage FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own rows (initial creation on first request)
CREATE POLICY "realtime_usage_insert" ON realtime_usage FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own rows (cost/request_count increments)
CREATE POLICY "realtime_usage_update" ON realtime_usage FOR UPDATE
  USING (user_id = auth.uid());
