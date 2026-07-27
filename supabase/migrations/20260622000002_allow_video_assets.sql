-- Allow self-hosting converted screen-recording videos (large GIFs are
-- transcoded to MP4/WebM on import for performance) in the images bucket.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm'
]
WHERE id = 'images';
