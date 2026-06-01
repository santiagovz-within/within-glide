-- Store reference/frame images alongside each user chat message for display.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS reference_image_urls text[];
