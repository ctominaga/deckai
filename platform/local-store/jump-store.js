const STORAGE_KEY = "deckai.jump-content.v1";

function readItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function makeId() {
  return `jump_${crypto.randomUUID()}`;
}

export function listJumpContent({ status, query, category } = {}) {
  const normalizedQuery = query?.trim().toLowerCase();
  return readItems().filter((item) => {
    const matchesStatus = !status || item.status === status;
    const matchesCategory = !category || item.category === category;
    const searchable = `${item.title} ${item.body} ${(item.tags ?? []).join(" ")}`.toLowerCase();
    const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
    return matchesStatus && matchesCategory && matchesQuery;
  });
}

export function createJumpContent({ title, body, category, tags = [], source, validUntil, createdBy = "local-user" }) {
  if (!title?.trim() || !body?.trim() || !category?.trim()) throw new Error("JUMP_REQUIRED_FIELDS");
  if (!source?.url && !source?.assetId) throw new Error("JUMP_SOURCE_REQUIRED");

  const now = new Date().toISOString();
  const item = {
    contentId: makeId(), title: title.trim(), body: body.trim(), category: category.trim(),
    tags, source, validUntil: validUntil ?? null, status: "draft", version: 1,
    createdBy, createdAt: now, updatedAt: now, review: null
  };
  writeItems([...readItems(), item]);
  return item;
}

export function submitJumpForReview(contentId) {
  return changeStatus(contentId, "in_review");
}

export function approveJumpContent(contentId, { approvedBy, validFrom, validUntil, note = "" }) {
  if (!approvedBy || !validFrom || !validUntil) throw new Error("APPROVAL_METADATA_REQUIRED");
  const item = changeStatus(contentId, "approved");
  item.validFrom = validFrom; item.validUntil = validUntil;
  item.review = { approvedBy, approvedAt: new Date().toISOString(), note };
  writeItems(readItems().map((current) => current.contentId === contentId ? item : current));
  return item;
}

export function rejectJumpContent(contentId, note) {
  if (!note?.trim()) throw new Error("REJECTION_NOTE_REQUIRED");
  const item = changeStatus(contentId, "rejected");
  item.review = { rejectedAt: new Date().toISOString(), note };
  writeItems(readItems().map((current) => current.contentId === contentId ? item : current));
  return item;
}

export function listEligibleJumpContent(at = new Date()) {
  const date = new Date(at).toISOString().slice(0, 10);
  return readItems().filter((item) => item.status === "approved" && item.validFrom <= date && item.validUntil >= date && item.source);
}

export function seedJumpContent(items) {
  writeItems(items ?? []);
}

function changeStatus(contentId, status) {
  const items = readItems();
  const item = items.find((current) => current.contentId === contentId);
  if (!item) throw new Error("JUMP_CONTENT_NOT_FOUND");
  const allowed = {
    draft: ["in_review"], in_review: ["approved", "rejected"], rejected: ["draft"],
    approved: ["expired", "archived"], expired: ["archived"], archived: []
  };
  if (!allowed[item.status].includes(status)) throw new Error("INVALID_JUMP_TRANSITION");
  item.status = status; item.updatedAt = new Date().toISOString();
  writeItems(items);
  return item;
}
