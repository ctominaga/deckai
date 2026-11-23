import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

export async function audit(database: Database, event: { organizationId: string; actorId?: string; action: string; entityType: string; entityId?: string; requestId?: string; metadata?: unknown }): Promise<void> {
  await database.query(`INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, metadata_json, request_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [randomUUID(), event.organizationId, event.actorId ?? null, event.action, event.entityType, event.entityId ?? null, JSON.stringify(event.metadata ?? {}), event.requestId ?? null]);
}
