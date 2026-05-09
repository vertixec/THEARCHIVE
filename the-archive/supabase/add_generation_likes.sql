-- Allow generated assets to participate in the existing favorites system.
-- Run this in Supabase SQL Editor if liking a creation shows FAVORITES SYNC FAILED.

ALTER TABLE public.user_likes
  DROP CONSTRAINT IF EXISTS user_likes_item_type_check;

ALTER TABLE public.user_likes
  ADD CONSTRAINT user_likes_item_type_check
  CHECK (item_type IN ('visual', 'system', 'community', 'workflow', 'generation'));
