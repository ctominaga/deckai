CREATE TABLE jump_contents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind varchar(30) NOT NULL CHECK (kind IN ('history','service','client','case','metric','image','brand','source_document')),
  title varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','rejected','archived')),
  current_version_id uuid,
  approved_version_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id)
);

CREATE TABLE jump_content_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  content_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  body_json jsonb NOT NULL,
  source_label varchar(240) NOT NULL,
  source_url text,
  source_locator varchar(240),
  valid_from date,
  valid_until date,
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, version_number),
  UNIQUE (id, content_id, organization_id),
  FOREIGN KEY (content_id, organization_id) REFERENCES jump_contents(id, organization_id),
  FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id),
  CHECK (jsonb_typeof(body_json) = 'object'),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

ALTER TABLE jump_contents
  ADD CONSTRAINT jump_current_version_fk
  FOREIGN KEY (current_version_id, id, organization_id)
  REFERENCES jump_content_versions(id, content_id, organization_id);

ALTER TABLE jump_contents
  ADD CONSTRAINT jump_approved_version_fk
  FOREIGN KEY (approved_version_id, id, organization_id)
  REFERENCES jump_content_versions(id, content_id, organization_id);

CREATE TABLE jump_reviews (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  content_id uuid NOT NULL,
  version_id uuid NOT NULL,
  action varchar(20) NOT NULL CHECK (action IN ('submitted','approved','rejected','archived')),
  note text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (content_id, organization_id) REFERENCES jump_contents(id, organization_id),
  FOREIGN KEY (version_id, content_id, organization_id) REFERENCES jump_content_versions(id, content_id, organization_id),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id)
);

CREATE INDEX jump_contents_search_idx ON jump_contents (organization_id, status, kind, updated_at DESC);
CREATE INDEX jump_versions_content_idx ON jump_content_versions (content_id, version_number DESC);
CREATE INDEX jump_reviews_content_idx ON jump_reviews (content_id, created_at DESC);
