BEGIN;

-- Production generations.source_id is text because it references multiple source
-- tables; flows.id is uuid. Cast explicitly in both attribution directions.
-- Preserve the flow primary-key lookup and the generation source text index.
CREATE OR REPLACE FUNCTION public.attribute_generation_client() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_client uuid; flow_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Generation source cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'Change the client on the flow instead' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_type = 'canvas' THEN
    SELECT client_id, user_id INTO selected_client, flow_owner
      FROM public.flows WHERE id = NEW.source_id::uuid FOR SHARE;
    IF flow_owner IS NULL OR flow_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'An owned flow is required' USING ERRCODE = '23514';
    END IF;
    IF selected_client IS NULL THEN
      RAISE EXCEPTION 'Choose a client for this flow before generating' USING ERRCODE = '23514';
    END IF;
    NEW.client_id := selected_client;
  ELSE
    NEW.client_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_flow_generation_clients() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.generations SET client_id = NEW.client_id
    WHERE source_type = 'canvas' AND source_id::text = NEW.id::text
      AND client_id IS DISTINCT FROM NEW.client_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.attribute_generation_client() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_flow_generation_clients() FROM PUBLIC;

COMMIT;
