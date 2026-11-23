CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(120) NOT NULL,
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE UNIQUE INDEX users_email_global_bootstrap_idx ON users (lower(email));

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE themes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(120) NOT NULL,
  tokens jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE presentations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE presentation_versions (
  id uuid PRIMARY KEY,
  presentation_id uuid NOT NULL REFERENCES presentations(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  schema_version varchar(20) NOT NULL,
  state varchar(20) NOT NULL CHECK (state IN ('checkpoint', 'confirmed')),
  content_json jsonb NOT NULL,
  content_hash char(64) NOT NULL,
  base_version_id uuid REFERENCES presentation_versions(id),
  client_mutation_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presentation_id, version_number),
  UNIQUE (presentation_id, client_mutation_id)
);

ALTER TABLE presentations
  ADD CONSTRAINT presentations_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES presentation_versions(id);

CREATE TABLE presentation_drafts (
  presentation_id uuid PRIMARY KEY REFERENCES presentations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  base_version_id uuid NOT NULL REFERENCES presentation_versions(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_json jsonb NOT NULL,
  last_mutation_id uuid NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  presentation_id uuid NOT NULL REFERENCES presentations(id),
  version_id uuid NOT NULL REFERENCES presentation_versions(id),
  format varchar(10) NOT NULL CHECK (format IN ('html', 'pdf', 'pptx')),
  status varchar(20) NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled', 'dead_letter')),
  idempotency_key varchar(255) NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  error_json jsonb,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE export_artifacts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  job_id uuid NOT NULL UNIQUE REFERENCES export_jobs(id),
  storage_key text NOT NULL,
  media_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid REFERENCES users(id),
  action varchar(120) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id varchar(80),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX presentations_org_updated_idx ON presentations (organization_id, updated_at DESC);
CREATE INDEX versions_presentation_created_idx ON presentation_versions (presentation_id, version_number DESC);
CREATE INDEX jobs_available_idx ON export_jobs (status, available_at);
CREATE INDEX audit_org_occurred_idx ON audit_events (organization_id, occurred_at DESC);
