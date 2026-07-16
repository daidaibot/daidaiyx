const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const ops = require("./ops");

const ADMIN_TTL_MS = 30 * 24 * 3600 * 1000;
const USER_TTL_MS = 90 * 24 * 3600 * 1000;
const USERS_FILE = () => path.join(ops.DATA_DIR, "users.json");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function now() {
  return Date.now();
}

function ensureDataDir() {
  if (!fs.existsSync(ops.DATA_DIR)) fs.mkdirSync(ops.DATA_DIR, { recursive: true });
}

function readUsersFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(USERS_FILE())) return [];
    const raw = JSON.parse(fs.readFileSync(USERS_FILE(), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeUsersFile(list) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE(), JSON.stringify(list, null, 2), "utf8");
}

function upsertUserFile({ openid, unionid, platform, nickName, avatarUrl }) {
  if (!openid) return null;
  const list = readUsersFile();
  const ts = now();
  const idx = list.findIndex((u) => u.openid === openid);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      unionid: unionid || prev.unionid || "",
      platform: platform || prev.platform || "wechat",
      nickName: nickName || prev.nickName || "",
      avatarUrl: avatarUrl || prev.avatarUrl || "",
      updatedAt: ts,
      lastLoginAt: ts,
      loginCount: Number(prev.loginCount || 0) + 1,
    };
  } else {
    list.push({
      id: list.length + 1,
      openid,
      unionid: unionid || "",
      platform: platform || "wechat",
      nickName: nickName || "",
      avatarUrl: avatarUrl || "",
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: ts,
      loginCount: 1,
    });
  }
  writeUsersFile(list);
  return list.find((u) => u.openid === openid) || null;
}

async function upsertUser({ openid, unionid, platform, nickName, avatarUrl }) {
  if (!openid) return null;
  const fileUser = upsertUserFile({ openid, unionid, platform, nickName, avatarUrl });
  if (!db.isReady()) return fileUser;

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
  return rows[0] || fileUser;
}

async function listUsers({ limit = 50, offset = 0, q = "" } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const keyword = String(q || "").trim();

  if (db.isReady()) {
    const params = [];
    let where = "";
    if (keyword) {
      where = "WHERE openid LIKE ? OR nick_name LIKE ?";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const countRows = await db.query(
      `SELECT COUNT(*) AS c FROM users ${where}`,
      params
    );
    const total = Number((countRows[0] && countRows[0].c) || 0);
    const rows = await db.query(
      `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
              created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
       FROM users ${where}
       ORDER BY last_login_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    return { total, users: rows, source: "mysql" };
  }

  let list = readUsersFile();
  if (keyword) {
    const k = keyword.toLowerCase();
    list = list.filter(
      (u) =>
        String(u.openid || "").toLowerCase().includes(k) ||
        String(u.nickName || "").toLowerCase().includes(k)
    );
  }
  list.sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
  return {
    total: list.length,
    users: list.slice(off, off + lim),
    source: "file",
  };
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
  listUsers,
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
