-- Add sharing flag to flows table
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;
