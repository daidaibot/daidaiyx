const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const JOB_FILE = path.join(DATA_DIR, "image-jobs.json");
const MAX_JOBS = 80;
const JOB_TTL_MS = 2 * 3600 * 1000;

/** @type {Map<string, object>} */
const jobs = new Map();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJobs() {
  try {
    if (!fs.existsSync(JOB_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(JOB_FILE, "utf8"));
    if (!Array.isArray(raw)) return;
    const now = Date.now();
    for (const j of raw) {
      if (!j || !j.id) continue;
      if (now - (j.updatedAt || j.createdAt || 0) > JOB_TTL_MS) continue;
      jobs.set(j.id, j);
    }
  } catch (e) {
    console.error("loadJobs failed:", e.message);
  }
}

function saveJobs() {
  try {
    ensureDir();
    const list = Array.from(jobs.values())
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_JOBS);
    fs.writeFileSync(JOB_FILE, JSON.stringify(list), "utf8");
  } catch (e) {
    console.error("saveJobs failed:", e.message);
  }
}

loadJobs();

function createJob( partial ) {
  const id = `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const row = Object.assign(
    {
      id,
      status: "pending", // pending | done | error
      createdAt: Date.now(),
      updatedAt: Date.now(),
      prompt: "",
      size: "1024x1024",
      image: "",
      imageId: "",
      error: "",
      ms: 0,
    },
    partial || {}
  );
  jobs.set(id, row);
  saveJobs();
  return row;
}

function updateJob(id, patch) {
  const cur = jobs.get(id);
  if (!cur) return null;
  const next = Object.assign({}, cur, patch || {}, { updatedAt: Date.now() });
  jobs.set(id, next);
  saveJobs();
  return next;
}

function getJob(id) {
  const safe = String(id || "");
  const row = jobs.get(safe);
  if (!row) return null;
  if (Date.now() - (row.updatedAt || row.createdAt || 0) > JOB_TTL_MS) {
    jobs.delete(safe);
    saveJobs();
    return null;
  }
  return row;
}

function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    image: row.image || "",
    imageId: row.imageId || "",
    error: row.error || "",
    ms: row.ms || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

module.exports = {
  createJob,
  updateJob,
  getJob,
  publicJob,
};
