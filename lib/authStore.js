const crypto = require("crypto");
const db = require("./db");

const ADMIN_TTL_MS = 30 * 24 * 3600 * 1000;
const USER_TTL_MS = 90 * 24 * 3600 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function now() {
  return Date.now();
}

async function upsertUser({ openid, unionid, platform, nickName, avatarUrl }) {
  if (!db.isReady() || !openid) return null;
  const ts = now();
  await db.exec(
    `INSERT INTO users (openid, unionid, platform, nick_name, avatar_url, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unionid = VALUES(unionid),
       platform = VALUES(platform),
       nick_name = IF(VALUES(nick_name) <> '', VALUES(nick_name), nick_name),
       avatar_url = IF(VALUES(avatar_url) <> '', VALUES(avatar_url), avatar_url),
       updated_at = VALUES(updated_at),
       last_login_at = VALUES(last_login_at)`,
    [
      openid,
      unionid || "",
      platform || "wechat",
      nickName || "",
      avatarUrl || "",
      ts,
      ts,
      ts,
    ]
  );
  const rows = await db.query("SELECT id, openid FROM users WHERE openid = ? LIMIT 1", [openid]);
  return rows[0] || null;
}

async function createSession({ token, role, openid, userId, ip, ttlMs }) {
  if (!db.isReady() || !token) return false;
  const ts = now();
  const expiresAt = ts + (ttlMs || (role === "admin" ? ADMIN_TTL_MS : USER_TTL_MS));
  await db.exec(
    `INSERT INTO auth_sessions (token_hash, role, user_id, openid, expires_at, created_at, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role = VALUES(role),
       user_id = VALUES(user_id),
       openid = VALUES(openid),
       expires_at = VALUES(expires_at),
       ip = VALUES(ip)`,
    [hashToken(token), role, userId || null, openid || "", expiresAt, ts, ip || ""]
  );
  return true;
}

async function revokeSession(token) {
  if (!db.isReady() || !token) return;
  await db.exec("DELETE FROM auth_sessions WHERE token_hash = ?", [hashToken(token)]);
}

async function resolveSession(token) {
  if (!token) return null;
  if (db.isReady()) {
    const rows = await db.query(
      `SELECT role, openid, user_id, expires_at FROM auth_sessions WHERE token_hash = ? LIMIT 1`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (row && Number(row.expires_at) > now()) {
      return {
        role: row.role,
        openid: row.openid,
        userId: row.user_id,
      };
    }
  }
  // 兼容旧 token：wx_{openid}_* / web_{openid}_* / dev_{openid}
  const m = String(token).match(/^(?:wx|web|dev)_(.+?)_/);
  if (m && m[1]) {
    return { role: "user", openid: m[1], userId: null };
  }
  if (String(token).startsWith("adm_")) {
    return { role: "admin", openid: "", userId: null };
  }
  return null;
}

async function validateAdminToken(token) {
  const sess = await resolveSession(token);
  return Boolean(sess && sess.role === "admin");
}

async function validateUserToken(token) {
  const sess = await resolveSession(token);
  return sess && sess.role === "user" ? sess : null;
}

function bearerToken(req) {
  const header = String((req && req.headers && req.headers.authorization) || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function userAuthOptional(req, _res, next) {
  const token = bearerToken(req);
  if (token) {
    const sess = await validateUserToken(token);
    if (sess) {
      req.user = { openid: sess.openid, userId: sess.userId };
    }
  }
  next();
}

async function userAuthRequired(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: { message: "请先登录" } });
  }
  const sess = await validateUserToken(token);
  if (!sess || !sess.openid) {
    return res.status(401).json({ ok: false, error: { message: "登录已过期，请重新登录" } });
  }
  req.user = { openid: sess.openid, userId: sess.userId };
  next();
}

function adminAuthFactory(fallbackSet) {
  return async function adminAuth(req, res, next) {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ error: { message: "未登录或已过期" } });
    }
    if (db.isReady()) {
      const ok = await validateAdminToken(token);
      if (ok) return next();
    }
    if (fallbackSet && fallbackSet.has(token)) return next();
    return res.status(401).json({ error: { message: "未登录或已过期" } });
  };
}

module.exports = {
  upsertUser,
  createSession,
  revokeSession,
  resolveSession,
  validateAdminToken,
  validateUserToken,
  bearerToken,
  userAuthOptional,
  userAuthRequired,
  adminAuthFactory,
  ADMIN_TTL_MS,
  USER_TTL_MS,
};
