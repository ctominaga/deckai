ALTER TABLE users ADD CONSTRAINT users_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE sessions ADD CONSTRAINT sessions_user_organization_fk FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id);

ALTER TABLE themes ADD CONSTRAINT themes_id_organization_unique UNIQUE (id, organization_id);
CREATE UNIQUE INDEX themes_one_default_per_organization ON themes (organization_id) WHERE is_default = true;

ALTER TABLE presentations ADD CONSTRAINT presentations_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE presentations ADD CONSTRAINT presentations_creator_organization_fk FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id);

ALTER TABLE presentation_versions ADD COLUMN organization_id uuid;
UPDATE presentation_versions version
SET organization_id = presentation.organization_id
FROM presentations presentation
WHERE presentation.id = version.presentation_id;
ALTER TABLE presentation_versions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE presentation_versions ADD CONSTRAINT versions_id_presentation_organization_unique UNIQUE (id, presentation_id, organization_id);
ALTER TABLE presentation_versions ADD CONSTRAINT versions_presentation_organization_fk FOREIGN KEY (presentation_id, organization_id) REFERENCES presentations(id, organization_id);
ALTER TABLE presentation_versions ADD CONSTRAINT versions_creator_organization_fk FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id);

ALTER TABLE presentations DROP CONSTRAINT presentations_current_version_fk;
ALTER TABLE presentations ADD CONSTRAINT presentations_current_version_fk FOREIGN KEY (current_version_id, id, organization_id) REFERENCES presentation_versions(id, presentation_id, organization_id);

ALTER TABLE presentation_drafts ADD CONSTRAINT drafts_presentation_organization_fk FOREIGN KEY (presentation_id, organization_id) REFERENCES presentations(id, organization_id);
ALTER TABLE presentation_drafts ADD CONSTRAINT drafts_base_version_fk FOREIGN KEY (base_version_id, presentation_id, organization_id) REFERENCES presentation_versions(id, presentation_id, organization_id);
ALTER TABLE presentation_drafts ADD CONSTRAINT drafts_editor_organization_fk FOREIGN KEY (updated_by, organization_id) REFERENCES users(id, organization_id);

ALTER TABLE export_jobs ADD CONSTRAINT jobs_id_organization_unique UNIQUE (id, organization_id);
ALTER TABLE export_jobs ADD CONSTRAINT jobs_presentation_organization_fk FOREIGN KEY (presentation_id, organization_id) REFERENCES presentations(id, organization_id);
ALTER TABLE export_jobs ADD CONSTRAINT jobs_version_presentation_organization_fk FOREIGN KEY (version_id, presentation_id, organization_id) REFERENCES presentation_versions(id, presentation_id, organization_id);
ALTER TABLE export_jobs ADD CONSTRAINT jobs_requester_organization_fk FOREIGN KEY (requested_by, organization_id) REFERENCES users(id, organization_id);
ALTER TABLE export_artifacts ADD CONSTRAINT artifacts_job_organization_fk FOREIGN KEY (job_id, organization_id) REFERENCES export_jobs(id, organization_id);

CREATE TABLE installation_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  bootstrapped boolean NOT NULL
);
INSERT INTO installation_state (id, bootstrapped) SELECT 1, EXISTS (SELECT 1 FROM users);

CREATE TABLE presentation_mutations (
  presentation_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  client_mutation_id uuid NOT NULL,
  operation varchar(30) NOT NULL CHECK (operation IN ('autosave')),
  payload_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (presentation_id, client_mutation_id),
  FOREIGN KEY (presentation_id, organization_id) REFERENCES presentations(id, organization_id)
);

CREATE INDEX sessions_expiration_idx ON sessions (expires_at);
