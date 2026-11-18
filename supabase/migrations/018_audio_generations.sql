BEGIN;

ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_media_type_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_media_type_check
  CHECK (media_type IN ('image', 'video', 'prompt', 'audio'));

COMMIT;
