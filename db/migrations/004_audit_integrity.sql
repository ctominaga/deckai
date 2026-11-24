ALTER TABLE audit_events
  ADD CONSTRAINT audit_actor_organization_fk
  FOREIGN KEY (actor_id, organization_id)
  REFERENCES users(id, organization_id);
