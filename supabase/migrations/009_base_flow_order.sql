-- Persist the display order of template cards on the Canvas Flow page.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS base_flow_order INTEGER;

-- Preserve the existing created-at order when the column is introduced.
WITH ordered_templates AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1)::INTEGER AS position
  FROM public.flows
  WHERE is_template = TRUE
)
UPDATE public.flows AS flow
SET base_flow_order = ordered_templates.position
FROM ordered_templates
WHERE flow.id = ordered_templates.id
  AND flow.base_flow_order IS NULL;

CREATE INDEX IF NOT EXISTS flows_base_flow_order_idx
  ON public.flows (base_flow_order, created_at)
  WHERE is_template = TRUE;

-- Update every template position in one statement so a reorder is atomic.
-- The API invokes this with the service role after checking admin status.
CREATE OR REPLACE FUNCTION public.set_base_flow_order(ordered_flow_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF ordered_flow_ids IS NULL
    OR cardinality(ordered_flow_ids) <> (
      SELECT COUNT(DISTINCT supplied.flow_id)
      FROM unnest(ordered_flow_ids) AS supplied(flow_id)
    )
    OR EXISTS (
      SELECT flow.id
      FROM public.flows AS flow
      WHERE flow.is_template = TRUE
      EXCEPT
      SELECT supplied.flow_id
      FROM unnest(ordered_flow_ids) AS supplied(flow_id)
    )
    OR EXISTS (
      SELECT supplied.flow_id
      FROM unnest(ordered_flow_ids) AS supplied(flow_id)
      EXCEPT
      SELECT flow.id
      FROM public.flows AS flow
      WHERE flow.is_template = TRUE
    )
  THEN
    RAISE EXCEPTION 'Ordered flow IDs must contain every base flow exactly once';
  END IF;

  UPDATE public.flows AS flow
  SET base_flow_order = (ordered.position - 1)::INTEGER
  FROM unnest(ordered_flow_ids) WITH ORDINALITY AS ordered(id, position)
  WHERE flow.id = ordered.id
    AND flow.is_template = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_base_flow_order(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_base_flow_order(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_base_flow_order(UUID[]) TO service_role;
