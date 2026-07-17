/**
 * 用户自定义面具（仅 MySQL）
 */
const db = require("./db");

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪");
    err.code = "DB";
    throw err;
  }
}

function mapMask(r) {
  return {
    id: r.id,
    name: r.name || "",
    emoji: r.emoji || "🎭",
    desc: r.description || r.desc || "",
    prompt: r.prompt || "",
    hello: r.hello || "",
    builtin: false,
  };
}

async function listMasks(openid) {
  requireDb();
  const oid = String(openid || "").trim();
  if (!oid) return [];
  const rows = await db.query(
    `SELECT id, name, emoji, description, prompt, hello
     FROM user_masks WHERE openid = ?
     ORDER BY updated_at DESC`,
    [oid]
  );
  return rows.map(mapMask);
}

async function saveMask(openid, mask) {
  requireDb();
  const oid = String(openid || "").trim();
  if (!oid || !mask || !mask.id) {
    const err = new Error("参数无效");
    err.code = "BAD";
    throw err;
  }
  const now = Date.now();
  await db.exec(
    `INSERT INTO user_masks (id, openid, name, emoji, description, prompt, hello, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       emoji = VALUES(emoji),
       description = VALUES(description),
       prompt = VALUES(prompt),
       hello = VALUES(hello),
       updated_at = VALUES(updated_at)`,
    [
      String(mask.id),
      oid,
      String(mask.name || "").slice(0, 64),
      String(mask.emoji || "🎭").slice(0, 16),
      String(mask.desc || mask.description || "").slice(0, 128),
      String(mask.prompt || "").slice(0, 4000),
      String(mask.hello || "").slice(0, 512),
      now,
      now,
    ]
  );
  return listMasks(oid);
}

async function removeMask(openid, id) {
  requireDb();
  const oid = String(openid || "").trim();
  const mid = String(id || "").trim();
  if (!oid || !mid) return listMasks(oid);
  await db.exec("DELETE FROM user_masks WHERE openid = ? AND id = ?", [oid, mid]);
  return listMasks(oid);
}

module.exports = {
  listMasks,
  saveMask,
  removeMask,
};
