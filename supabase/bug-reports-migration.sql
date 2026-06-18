-- Run this in the Supabase SQL editor (Database → SQL Editor)

CREATE TABLE IF NOT EXISTS bug_reports (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  description text        NOT NULL,
  image_url   text,
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by uuid        REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bug_report_comments (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bug_report_id  uuid        NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content        text        NOT NULL,
  created_at     timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS bug_reports_user_id_idx       ON bug_reports(user_id);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx        ON bug_reports(status);
CREATE INDEX IF NOT EXISTS bug_report_comments_report_idx ON bug_report_comments(bug_report_id);

-- RLS
ALTER TABLE bug_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_report_comments ENABLE ROW LEVEL SECURITY;

-- Users can read their own reports; admins can read all
CREATE POLICY "bug_reports_select" ON bug_reports FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Any authenticated user can file a report for themselves
CREATE POLICY "bug_reports_insert" ON bug_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Only admins can update (mark resolved / reopen)
CREATE POLICY "bug_reports_update" ON bug_reports FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Comments visible to the report owner and admins
CREATE POLICY "bug_report_comments_select" ON bug_report_comments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM bug_reports WHERE id = bug_report_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Only admins can post comments
CREATE POLICY "bug_report_comments_insert" ON bug_report_comments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
