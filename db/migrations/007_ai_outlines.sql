CREATE TABLE presentation_outlines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title varchar(180) NOT NULL,
  briefing_json jsonb NOT NULL,
  slides_json jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id),
  CHECK (jsonb_typeof(briefing_json) = 'object'),
  CHECK (jsonb_typeof(slides_json) = 'array')
);

CREATE TABLE ai_generation_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  requested_by uuid NOT NULL,
  outline_id uuid,
  kind varchar(30) NOT NULL CHECK (kind IN ('outline','presentation','rewrite','slide_regeneration')),
  provider varchar(30) NOT NULL,
  model varchar(120) NOT NULL,
  prompt_version varchar(40) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('running','succeeded','failed')),
  idempotency_key uuid NOT NULL,
  input_json jsonb NOT NULL,
  output_json jsonb,
  usage_json jsonb,
  error_json jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id),
  FOREIGN KEY (requested_by, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (outline_id, organization_id) REFERENCES presentation_outlines(id, organization_id)
);

CREATE INDEX presentation_outlines_org_created_idx ON presentation_outlines (organization_id, created_at DESC);
CREATE INDEX ai_jobs_org_created_idx ON ai_generation_jobs (organization_id, created_at DESC);
