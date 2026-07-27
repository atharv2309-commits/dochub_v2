-- Allow larger imported assets (screenshots, short GIFs). Files above this are
-- hotlinked from the source instead of self-hosted.
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'images';  -- 25MB
