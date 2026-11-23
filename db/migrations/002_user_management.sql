ALTER TABLE users
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX users_organization_status_idx ON users (organization_id, status, created_at);
