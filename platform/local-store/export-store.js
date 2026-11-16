const STORAGE_KEY = "deckai.exports.v1";

function readExports() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function writeExports(exportsList) { localStorage.setItem(STORAGE_KEY, JSON.stringify(exportsList)); }

function makeId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

export function requestExport({ presentationId, versionId, format, requestedBy = "local-user" }) {
  if (!presentationId || !versionId || !["html", "pdf", "pptx"].includes(format)) {
    throw new Error("EXPORT_REQUIRED_FIELDS");
  }
  const exportsList = readExports();
  const idempotencyKey = `${presentationId}:${versionId}:${format}`;
  const existing = exportsList.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return { export: existing, reused: true };

  const item = {
    exportId: makeId("export"),
    presentationId,
    versionId,
    format,
    status: "queued",
    jobId: makeId("job"),
    idempotencyKey,
    requestedBy,
    artifact: null,
    createdAt: new Date().toISOString()
  };
  writeExports([...exportsList, item]);
  return { export: item, reused: false };
}

export function completeExport(exportId, { sizeBytes = 0, contentHash = "sha256:local" } = {}) {
  const exportsList = readExports();
  const item = exportsList.find((current) => current.exportId === exportId);
  if (!item) throw new Error("EXPORT_NOT_FOUND");
  item.status = "succeeded";
  item.artifact = {
    assetId: makeId("asset"),
    mediaType: mediaTypeFor(item.format),
    sizeBytes,
    contentHash,
    downloadExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
  item.completedAt = new Date().toISOString();
  writeExports(exportsList);
  return item;
}

export function failExport(exportId, error) {
  const exportsList = readExports();
  const item = exportsList.find((current) => current.exportId === exportId);
  if (!item) throw new Error("EXPORT_NOT_FOUND");
  item.status = "failed";
  item.error = error ?? { code: "EXPORT_FAILED", retryable: false };
  writeExports(exportsList);
  return item;
}

export function listExports() { return readExports(); }
export function clearExports() { localStorage.removeItem(STORAGE_KEY); }

function mediaTypeFor(format) {
  return {
    html: "application/zip",
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }[format];
}
