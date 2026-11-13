const DATA_KEYS = [
  "deckai.presentations.v1",
  "deckai.jump-content.v1",
  "deckai.jobs.v1",
  "deckai.auth.v1",
  "deckai.audit.v1"
];

export function createSnapshot() {
  const data = {};
  for (const key of DATA_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) data[key] = JSON.parse(raw);
  }
  return {
    snapshotVersion: "1.0",
    createdAt: new Date().toISOString(),
    data
  };
}

export function restoreSnapshot(snapshot) {
  if (!snapshot || snapshot.snapshotVersion !== "1.0" || !snapshot.data) {
    throw new Error("INVALID_SNAPSHOT");
  }
  for (const key of DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(snapshot.data, key)) {
      localStorage.setItem(key, JSON.stringify(snapshot.data[key]));
    }
  }
  return { restoredAt: new Date().toISOString(), keys: Object.keys(snapshot.data) };
}

export function downloadSnapshot(filename = "deckai-snapshot.json") {
  const blob = new Blob([JSON.stringify(createSnapshot(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
