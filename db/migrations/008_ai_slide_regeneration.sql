ALTER TABLE ai_generation_jobs
  ADD COLUMN presentation_id uuid,
  ADD COLUMN slide_id uuid;

ALTER TABLE ai_generation_jobs
  ADD CONSTRAINT ai_jobs_presentation_organization_fk
  FOREIGN KEY (presentation_id, organization_id)
  REFERENCES presentations(id, organization_id);

CREATE INDEX ai_jobs_presentation_created_idx ON ai_generation_jobs (presentation_id, created_at DESC);
