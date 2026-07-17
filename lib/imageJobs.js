/**
 * 异步生图/改图任务（仅 MySQL image_jobs）
 */
const crypto = require("crypto");
const db = require("./db");

const JOB_TTL_MS = 2 * 3600 * 1000;

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪");
    err.code = "DB";
    throw err;
  }
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    openid: row.openid || "",
    kind: row.kind || "generate",
    prompt: row.prompt || "",
    size: row.size || "",
    image: row.imageRef || row.image_ref || "",
    imageId: row.imageId || row.image_id || "",
    error: row.error || "",
    ms: Number(row.ms) || 0,
    createdAt: Number(row.createdAt || row.created_at) || 0,
    updatedAt: Number(row.updatedAt || row.updated_at) || 0,
  };
}

async function createJob(partial) {
  requireDb();
  const id = `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  const row = {
    id,
    status: "pending",
    openid: (partial && partial.openid) || "",
    kind: (partial && partial.kind) || "generate",
    prompt: String((partial && partial.prompt) || "").slice(0, 200),
    size: (partial && partial.size) || "1152x1536",
    image: "",
    imageId: "",
    error: "",
    ms: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.exec(
    `INSERT INTO image_jobs
      (id, openid, status, kind, prompt, size, image_id, image_ref, error, ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', '', 0, ?, ?)`,
    [row.id, row.openid, row.status, row.kind, row.prompt, row.size, now, now]
  );
  return row;
}

async function updateJob(id, patch) {
  requireDb();
  const safe = String(id || "");
  if (!safe) return null;
  const cur = await getJob(safe);
  if (!cur) return null;
  const next = Object.assign({}, cur, patch || {}, { updatedAt: Date.now() });
  await db.exec(
    `UPDATE image_jobs SET
       status = ?, kind = ?, prompt = ?, size = ?,
       image_id = ?, image_ref = ?, error = ?, ms = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.status || "pending",
      next.kind || "generate",
      String(next.prompt || "").slice(0, 200),
      next.size || "",
      next.imageId || "",
      next.image || "",
      String(next.error || "").slice(0, 512),
      Number(next.ms) || 0,
      next.updatedAt,
      safe,
    ]
  );
  return next;
}

async function getJob(id) {
  if (!db.isReady()) return null;
  const safe = String(id || "");
  if (!safe) return null;
  const rows = await db.query(
    `SELECT id, openid, status, kind, prompt, size,
            image_id AS imageId, image_ref AS imageRef, error, ms,
            created_at AS createdAt, updated_at AS updatedAt
     FROM image_jobs WHERE id = ? LIMIT 1`,
    [safe]
  );
  const row = rows[0];
  if (!row) return null;
  const updated = Number(row.updatedAt) || Number(row.createdAt) || 0;
  if (Date.now() - updated > JOB_TTL_MS) {
    try {
      await db.exec("DELETE FROM image_jobs WHERE id = ?", [safe]);
    } catch {
      /* ignore */
    }
    return null;
  }
  return toPublic(row);
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
