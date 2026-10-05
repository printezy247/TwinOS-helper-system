-- 0017 — a rejected draft must be storable.
--
-- approve/index.ts sets content_items.status = 'rejected' (setStatus), and the
-- 0011 §25 trigger mirrors the item status onto content_variants.status, which
-- is the content_status enum. The enum had no 'rejected', so every Reject (the
-- dashboard and the Desk button alike) failed with
-- "invalid input value for enum content_status: \"rejected\"".
-- No guard in trg_content_variant_guard treats 'rejected' specially: it is a
-- terminal state the publisher never picks up.

alter type public.content_status add value if not exists 'rejected';
