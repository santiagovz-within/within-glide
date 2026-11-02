BEGIN;

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_unique ON public.clients (lower(name));
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
CREATE POLICY clients_read ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_admin_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin));
CREATE POLICY clients_admin_update ON public.clients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin));

INSERT INTO public.clients (name) VALUES
  ('1800 Tequila'), ('Albany Park'), ('Amazon Web Services (AWS)'),
  ('Anthony''s Goods'), ('Assouline'), ('Avocado Mattress LLC'),
  ('Coldwater Creek Inc'), ('Crown Affair'), ('Dreamland Baby Co.'),
  ('Fair Harbor'), ('G-Star Raw'), ('Headspace'), ('Hickory Farms'),
  ('Mars'), ('Metagenics'), ('NESTiG'), ('NuFACE'), ('ODDITY'),
  ('PICOGRAM USA, INC'), ('Pureal'), ('quip'), ('Red Ventures, LLC'),
  ('Revlon'), ('Ro'), ('RTIC Coolers LLC'), ('Sergio Tacchini'),
  ('Smith Optics'), ('Strauss'), ('The North Face, Inc'), ('Timberland'),
  ('Too Good To Go'), ('Tossi Hair'), ('Touchland'), ('Two Dice'),
  ('Upside'), ('Vans, A VF Company');

-- Legacy flows stay unassigned until their owner chooses; never guess a client.
ALTER TABLE public.flows ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT;
ALTER TABLE public.generations ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT;
CREATE INDEX flows_client_id_idx ON public.flows(client_id);
CREATE INDEX flows_untagged_owner_idx ON public.flows(user_id, created_at) WHERE client_id IS NULL;
CREATE INDEX generations_client_created_idx ON public.generations(client_id, created_at);
CREATE INDEX generations_canvas_source_idx ON public.generations(source_id) WHERE source_type = 'canvas';

CREATE FUNCTION public.require_flow_client() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.client_id IS NULL AND (TG_OP = 'INSERT' OR OLD.client_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose a client for this flow' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_flow_client BEFORE INSERT OR UPDATE OF client_id ON public.flows
  FOR EACH ROW EXECUTE FUNCTION public.require_flow_client();

-- Derive attribution from the owned flow, never from an untrusted client ID.
-- Keep the recorded client when a flow is deleted. Legacy in-flight requests
-- may still complete before their owner tags the flow.
CREATE FUNCTION public.attribute_generation_client() RETURNS trigger
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
      FROM public.flows WHERE id = NEW.source_id FOR SHARE;
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
CREATE TRIGGER attribute_generation_client BEFORE INSERT OR UPDATE ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.attribute_generation_client();

-- First assignment backfills retained history; corrections move all of this
-- workflow's costs atomically, including generations owned by a former user.
CREATE FUNCTION public.sync_flow_generation_clients() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.generations SET client_id = NEW.client_id
    WHERE source_type = 'canvas' AND source_id = NEW.id
      AND client_id IS DISTINCT FROM NEW.client_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_flow_generation_clients AFTER UPDATE OF client_id ON public.flows
  FOR EACH ROW WHEN (NEW.client_id IS DISTINCT FROM OLD.client_id)
  EXECUTE FUNCTION public.sync_flow_generation_clients();

REVOKE ALL ON FUNCTION public.require_flow_client() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attribute_generation_client() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_flow_generation_clients() FROM PUBLIC;

COMMIT;
