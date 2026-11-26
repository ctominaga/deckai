CREATE TABLE image_assets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(180) NOT NULL,
  media_type varchar(40) NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 12000),
  content_hash char(64) NOT NULL,
  file_data bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(file_data) = size_bytes),
  FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id),
  UNIQUE (organization_id, content_hash)
);
CREATE INDEX image_assets_org_created_idx ON image_assets (organization_id, created_at DESC);
