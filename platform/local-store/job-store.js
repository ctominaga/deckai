const STORAGE_KEY = "deckai.jobs.v1";

function readJobs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function writeJobs(jobs) { localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs)); }

export function enqueueJob({ type, idempotencyKey, payload = {}, maxAttempts = 3 }) {
  if (!type || !idempotencyKey) throw new Error("JOB_REQUIRED_FIELDS");
  const jobs = readJobs();
  const existing = jobs.find((job) => job.idempotencyKey === idempotencyKey);
  if (existing) return { job: existing, reused: true };
  const job = {
    jobId: `job_${crypto.randomUUID()}`, type, status: "queued", attempt: 0,
    maxAttempts, idempotencyKey, payload, error: null, createdAt: new Date().toISOString()
  };
  writeJobs([...jobs, job]);
  return { job, reused: false };
}

export function listJobs() { return readJobs(); }

export function updateJob(jobId, patch) {
  const jobs = readJobs();
  const job = jobs.find((item) => item.jobId === jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  writeJobs(jobs);
  return job;
}

export function failJob(jobId, error) {
  const jobs = readJobs();
  const job = jobs.find((item) => item.jobId === jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");
  job.attempt += 1; job.error = error;
  job.status = error?.retryable && job.attempt < job.maxAttempts ? "retrying" : "failed";
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  return job;
}

export function clearJobs() { localStorage.removeItem(STORAGE_KEY); }
