const STORAGE_KEY = "deckai.audit.v1";

function readEvents() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function writeEvents(events) { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }

export function recordAudit({ event, actorId = "local-user", resourceType, resourceId, details = {} }) {
  if (!event || !resourceType || !resourceId) throw new Error("AUDIT_REQUIRED_FIELDS");
  const entry = {
    auditId: `audit_${crypto.randomUUID()}`,
    event,
    actorId,
    resourceType,
    resourceId,
    details,
    createdAt: new Date().toISOString()
  };
  writeEvents([...readEvents(), entry]);
  return entry;
}

export function listAudit({ resourceType, resourceId, event } = {}) {
  return readEvents().filter((item) =>
    (!resourceType || item.resourceType === resourceType) &&
    (!resourceId || item.resourceId === resourceId) &&
    (!event || item.event === event)
  );
}

export function clearAudit() { localStorage.removeItem(STORAGE_KEY); }
