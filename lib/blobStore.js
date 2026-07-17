/**
 * 二进制文件仅存 MySQL（头像、生图等），不落本地磁盘
 */
const db = require("./db");

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪");
    err.code = "DB";
    throw err;
  }
}

function safeId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

async function saveBlob({ id, kind, mime, data, ttlMs }) {
  requireDb();
  const bid = safeId(id);
  if (!bid || !data || !Buffer.isBuffer(data) || !data.length) return null;
  const now = Date.now();
  const expiresAt = ttlMs ? now + ttlMs : null;
  await db.exec(
    `INSERT INTO blobs (id, kind, mime, data, bytes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       kind = VALUES(kind),
       mime = VALUES(mime),
       data = VALUES(data),
       bytes = VALUES(bytes),
       created_at = VALUES(created_at),
       expires_at = VALUES(expires_at)`,
    [
      bid,
      String(kind || "file").slice(0, 16),
      String(mime || "application/octet-stream").slice(0, 64),
      data,
      data.length,
      now,
      expiresAt,
    ]
  );
  return { id: bid, bytes: data.length, mime: mime || "application/octet-stream" };
}

async function getBlob(id) {
  if (!db.isReady()) return null;
  const bid = safeId(id);
  if (!bid) return null;
  const rows = await db.query(
    `SELECT id, kind, mime, data, bytes, created_at AS createdAt, expires_at AS expiresAt
     FROM blobs WHERE id = ? LIMIT 1`,
    [bid]
  );
  const row = rows[0];
  if (!row || !row.data) return null;
  if (row.expiresAt && Number(row.expiresAt) < Date.now()) {
    await db.exec("DELETE FROM blobs WHERE id = ?", [bid]).catch(() => {});
    return null;
  }
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime || "application/octet-stream",
    data: buf,
    bytes: Number(row.bytes) || buf.length,
    createdAt: Number(row.createdAt) || 0,
    expiresAt: row.expiresAt ? Number(row.expiresAt) : null,
  };
}

async function deleteBlob(id) {
  if (!db.isReady()) return;
  const bid = safeId(id);
  if (!bid) return;
  await db.exec("DELETE FROM blobs WHERE id = ?", [bid]);
}

async function cleanupExpired(kind) {
  if (!db.isReady()) return 0;
  const now = Date.now();
  let sql = "DELETE FROM blobs WHERE (expires_at IS NOT NULL AND expires_at < ?)";
  const params = [now];
  if (kind) {
    sql += " OR (kind = ? AND created_at < ?)";
    params.push(String(kind).slice(0, 16), now - MAX_AGE_MS);
  } else {
    sql += " OR (created_at < ? AND kind IN ('image', 'gen-image'))";
    params.push(now - MAX_AGE_MS);
  }
  const result = await db.exec(sql, params);
  return Number(result.affectedRows || 0);
}

module.exports = {
  saveBlob,
  getBlob,
  deleteBlob,
  cleanupExpired,
  safeId,
  MAX_AGE_MS,
};
