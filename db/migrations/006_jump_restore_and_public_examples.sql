ALTER TABLE jump_contents
  ADD COLUMN external_key varchar(120);

CREATE UNIQUE INDEX jump_contents_external_key_unique
  ON jump_contents (organization_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE jump_reviews
  DROP CONSTRAINT jump_reviews_action_check;

ALTER TABLE jump_reviews
  ADD CONSTRAINT jump_reviews_action_check
  CHECK (action IN ('submitted','approved','rejected','archived','restored'));
