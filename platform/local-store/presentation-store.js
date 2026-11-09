/**
 * Armazenamento local temporário para o protótipo do Deck AI.
 * Será substituído por uma API/banco na implementação de produção.
 */

const STORAGE_KEY = "deckai.presentations.v1";

function readPresentations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writePresentations(presentations) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presentations));
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function listPresentations() {
  return readPresentations();
}

export function getPresentation(presentationId) {
  return readPresentations().find((item) => item.presentationId === presentationId) ?? null;
}

export function createPresentation({ title, content, createdBy = "local-user" }) {
  if (!title?.trim()) throw new Error("TITLE_REQUIRED");
  if (!content || !Array.isArray(content.slides)) throw new Error("PRESENTATION_CONTENT_INVALID");

  const now = new Date().toISOString();
  const presentationId = makeId("pres");
  const versionId = makeId("ver");
  const presentation = {
    presentationId,
    title: title.trim(),
    status: "draft",
    currentVersionId: versionId,
    versions: [{
      versionId,
      versionNumber: 1,
      schemaVersion: content.schemaVersion ?? "1.0",
      source: "local_user",
      createdBy,
      createdAt: now,
      content
    }]
  };

  writePresentations([...readPresentations(), presentation]);
  return presentation;
}

export function saveVersion({ presentationId, baseVersionId, content, createdBy = "local-user" }) {
  if (!content || !Array.isArray(content.slides)) throw new Error("PRESENTATION_CONTENT_INVALID");

  const presentations = readPresentations();
  const presentation = presentations.find((item) => item.presentationId === presentationId);
  if (!presentation) throw new Error("PRESENTATION_NOT_FOUND");
  if (baseVersionId && presentation.currentVersionId !== baseVersionId) throw new Error("VERSION_CONFLICT");

  const now = new Date().toISOString();
  const versionId = makeId("ver");
  const nextVersion = {
    versionId,
    versionNumber: presentation.versions.length + 1,
    schemaVersion: content.schemaVersion ?? "1.0",
    source: "local_user",
    baseVersionId: presentation.currentVersionId,
    createdBy,
    createdAt: now,
    content
  };

  presentation.versions.push(nextVersion);
  presentation.currentVersionId = versionId;
  writePresentations(presentations);
  return nextVersion;
}

export function clearLocalPresentations() {
  localStorage.removeItem(STORAGE_KEY);
}
