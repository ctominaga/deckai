CREATE TABLE image_assets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  uploaded_by uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data bytea NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880 AND octet_length(data) = size_bytes),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (uploaded_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX image_assets_org_id_idx ON image_assets (organization_id, id);
