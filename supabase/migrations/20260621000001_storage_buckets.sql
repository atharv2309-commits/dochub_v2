-- Create storage bucket for page images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,
  26214400,  -- 25MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload images
CREATE POLICY "images_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'images');

-- Allow public read of images
CREATE POLICY "images_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'images');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "images_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'images');
