const db = require("./db");

async function getJson(key, fallback) {
  if (!db.isReady() || !key) return fallback;
  const rows = await db.query("SELECT v FROM kv_store WHERE k = ? LIMIT 1", [key]);
  if (!rows.length) return fallback;
  try {
    return JSON.parse(rows[0].v);
  } catch {
    return fallback;
  }
}

async function setJson(key, value) {
  if (!db.isReady() || !key) return false;
  await db.exec(
    "INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)",
    [key, JSON.stringify(value), Date.now()]
  );
  return true;
}

async function appendAuditLog(entry) {
  if (!db.isReady() || !entry) return;
  await db.exec(
    "INSERT INTO audit_logs (at, method, path, status, ms, ip, openid) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      entry.at || Date.now(),
      entry.method || "",
      entry.path || "",
      entry.status || 0,
      entry.ms || 0,
      entry.ip || "",
      entry.openid || "",
    ]
  );
}

async function appendErrorLog(entry) {
  if (!db.isReady() || !entry || !entry.id) return;
  await db.exec(
    `INSERT INTO error_logs (id, at, source, message, status, path, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       at = VALUES(at),
       source = VALUES(source),
       message = VALUES(message),
       status = VALUES(status),
       path = VALUES(path),
       detail = VALUES(detail),
       ip = VALUES(ip)`,
    [
      entry.id,
      entry.at || Date.now(),
      entry.source || "",
      entry.message || "",
      entry.status || 0,
      entry.path || "",
      entry.detail || "",
      entry.ip || "",
    ]
  );
}

async function bumpHourlyDb(field, n = 1) {
  if (!db.isReady()) return;
  const d = new Date();
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
  const col = field === "imageEdit" ? "image_edit" : field;
  const allowed = new Set(["chat", "image", "image_edit", "login", "error", "req"]);
  if (!allowed.has(col)) return;
  await db.exec(
    `INSERT INTO hourly_metrics (hour_key, ${col}) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ${col} = ${col} + VALUES(${col})`,
    [k, n]
  );
}

async function getAuditLogs(limit = 80) {
  if (!db.isReady()) return null;
  return db.query(
    "SELECT at, method, path, status, ms, ip, openid FROM audit_logs ORDER BY at DESC LIMIT ?",
    [Math.min(limit, 300)]
  );
}

async function getErrorLogs(limit = 60) {
  if (!db.isReady()) return null;
  return db.query(
    "SELECT id, at, source, message, status, path, detail, ip FROM error_logs ORDER BY at DESC LIMIT ?",
    [Math.min(limit, 150)]
  );
}

async function clearLogsDb() {
  if (!db.isReady()) return;
  await db.exec("DELETE FROM audit_logs");
  await db.exec("DELETE FROM error_logs");
}

async function getHourlySeriesDb(hours = 24) {
  if (!db.isReady()) return null;
  const out = [];
  const now = new Date();
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600 * 1000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
    const rows = await db.query(
      "SELECT chat, image, image_edit AS imageEdit, login, error, req FROM hourly_metrics WHERE hour_key = ? LIMIT 1",
      [k]
    );
    const row = rows[0] || {};
    out.push({
      hour: k,
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      chat: row.chat || 0,
      image: row.image || 0,
      imageEdit: row.imageEdit || 0,
      login: row.login || 0,
      error: row.error || 0,
      req: row.req || 0,
    });
  }
  return out;
}

async function recordImageMeta(row) {
  if (!db.isReady() || !row || !row.id) return;
  await db.exec(
    `INSERT INTO images (id, openid, job_id, kind, prompt, size, file_path, bytes, watermarked, public_url, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       public_url = VALUES(public_url),
       bytes = VALUES(bytes)`,
    [
      row.id,
      row.openid || "",
      row.jobId || "",
      row.kind || "generate",
      row.prompt || "",
      row.size || "",
      row.filePath || "",
      row.bytes || 0,
      row.watermarked ? 1 : 0,
      row.publicUrl || "",
      row.createdAt || Date.now(),
      row.expiresAt || null,
    ]
  );
}

module.exports = {
  getJson,
  setJson,
  appendAuditLog,
  appendErrorLog,
  bumpHourlyDb,
  getAuditLogs,
  getErrorLogs,
  clearLogsDb,
  getHourlySeriesDb,
  recordImageMeta,
};
