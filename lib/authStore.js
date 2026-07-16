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

function makeUserToken(openid) {
  const id = String(openid || "");
  const payload = Buffer.from(id, "utf8").toString("base64url");
  const sig = hashToken(id).slice(0, 16);
  return `ac_${payload}_${sig}`;
}

function parseUserToken(token) {
  const m = String(token || "").match(/^ac_([A-Za-z0-9_-]+)_([a-f0-9]+)$/i);
  if (!m) return null;
  try {
    const openid = Buffer.from(m[1], "base64url").toString("utf8");
    if (!openid) return null;
    if (hashToken(openid).slice(0, 16) !== m[2]) return null;
    return openid;
  } catch {
    return null;
  }
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

function normalizePhone(phone) {
  const p = String(phone || "").replace(/\s+/g, "").trim();
  if (!/^1\d{10}$/.test(p)) return "";
  return p;
}

function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e;
}

function detectAccount(account) {
  const raw = String(account || "").trim();
  const phone = normalizePhone(raw);
  if (phone) return { type: "phone", value: phone };
  const email = normalizeEmail(raw);
  if (email) return { type: "email", value: email };
  return null;
}

function identityOpenid(type, value) {
  if (type === "phone") return `ph_${value}`;
  if (type === "email") return `em_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
  return `id_${hashToken(value).slice(0, 24)}`;
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), s, 32).toString("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password, stored) {
  const raw = String(stored || "");
  const [salt, hash] = raw.split(":");
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 32).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    openid: u.openid,
    unionid: u.unionid || "",
    platform: u.platform || "",
    nickName: u.nickName || u.nick_name || "",
    avatarUrl: u.avatarUrl || u.avatar_url || "",
    phone: u.phone || "",
    email: u.email || "",
    createdAt: u.createdAt || u.created_at || 0,
    updatedAt: u.updatedAt || u.updated_at || 0,
    lastLoginAt: u.lastLoginAt || u.last_login_at || 0,
    loginCount: u.loginCount || 0,
  };
}

function upsertUserFile(fields) {
  const openid = fields.openid;
  if (!openid) return null;
  const list = readUsersFile();
  const ts = now();
  const idx = list.findIndex((u) => u.openid === openid);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      unionid: fields.unionid != null ? fields.unionid : prev.unionid || "",
      platform: fields.platform || prev.platform || "account",
      nickName: fields.nickName || prev.nickName || "",
      avatarUrl: fields.avatarUrl || prev.avatarUrl || "",
      phone: fields.phone != null ? fields.phone : prev.phone || "",
      email: fields.email != null ? fields.email : prev.email || "",
      passwordHash:
        fields.passwordHash != null ? fields.passwordHash : prev.passwordHash || "",
      updatedAt: ts,
      lastLoginAt: fields.touchLogin === false ? prev.lastLoginAt || ts : ts,
      loginCount:
        fields.touchLogin === false
          ? Number(prev.loginCount || 0)
          : Number(prev.loginCount || 0) + 1,
    };
  } else {
    list.push({
      id: list.length + 1,
      openid,
      unionid: fields.unionid || "",
      platform: fields.platform || "account",
      nickName: fields.nickName || "",
      avatarUrl: fields.avatarUrl || "",
      phone: fields.phone || "",
      email: fields.email || "",
      passwordHash: fields.passwordHash || "",
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: ts,
      loginCount: 1,
    });
  }
  writeUsersFile(list);
  return publicUser(list.find((u) => u.openid === openid));
}

async function upsertUser(fields) {
  const openid = fields && fields.openid;
  if (!openid) return null;
  const fileUser = upsertUserFile(fields);
  if (!db.isReady()) return fileUser;

  const ts = now();
  await db.exec(
    `INSERT INTO users (openid, unionid, platform, nick_name, avatar_url, phone, email, password_hash, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unionid = COALESCE(VALUES(unionid), unionid),
       platform = VALUES(platform),
       nick_name = IF(VALUES(nick_name) <> '', VALUES(nick_name), nick_name),
       avatar_url = IF(VALUES(avatar_url) <> '', VALUES(avatar_url), avatar_url),
       phone = IF(VALUES(phone) <> '', VALUES(phone), phone),
       email = IF(VALUES(email) <> '', VALUES(email), email),
       password_hash = IF(VALUES(password_hash) <> '', VALUES(password_hash), password_hash),
       updated_at = VALUES(updated_at),
       last_login_at = VALUES(last_login_at)`,
    [
      openid,
      fields.unionid || "",
      fields.platform || "account",
      fields.nickName || "",
      fields.avatarUrl || "",
      fields.phone || "",
      fields.email || "",
      fields.passwordHash || "",
      ts,
      ts,
      ts,
    ]
  );
  const rows = await db.query(
    `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
            phone, email, created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
     FROM users WHERE openid = ? LIMIT 1`,
    [openid]
  );
  return publicUser(rows[0] || fileUser);
}

async function findUserByAccount(type, value) {
  if (!type || !value) return null;
  if (db.isReady()) {
    const col = type === "phone" ? "phone" : "email";
    const rows = await db.query(
      `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
              phone, email, password_hash AS passwordHash,
              created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
       FROM users WHERE ${col} = ? LIMIT 1`,
      [value]
    );
    if (rows[0]) return rows[0];
  }
  const list = readUsersFile();
  const hit = list.find((u) =>
    type === "phone" ? u.phone === value : String(u.email || "").toLowerCase() === value
  );
  return hit || null;
}

async function registerAccount({ account, password, nickName }) {
  const detected = detectAccount(account);
  if (!detected) {
    const err = new Error("请输入有效手机号或邮箱");
    err.code = "BAD_ACCOUNT";
    throw err;
  }
  if (!password || String(password).length < 6) {
    const err = new Error("密码至少 6 位");
    err.code = "BAD_PASSWORD";
    throw err;
  }
  const exists = await findUserByAccount(detected.type, detected.value);
  if (exists) {
    const err = new Error(detected.type === "phone" ? "该手机号已注册" : "该邮箱已注册");
    err.code = "EXISTS";
    throw err;
  }
  const openid = identityOpenid(detected.type, detected.value);
  const passwordHash = hashPassword(password);
  const display =
    String(nickName || "").trim() ||
    (detected.type === "phone"
      ? `用户${detected.value.slice(-4)}`
      : detected.value.split("@")[0]);
  const user = await upsertUser({
    openid,
    platform: detected.type,
    nickName: display,
    phone: detected.type === "phone" ? detected.value : "",
    email: detected.type === "email" ? detected.value : "",
    passwordHash,
    touchLogin: true,
  });
  return user;
}

async function loginAccount({ account, password }) {
  const detected = detectAccount(account);
  if (!detected) {
    const err = new Error("请输入有效手机号或邮箱");
    err.code = "BAD_ACCOUNT";
    throw err;
  }
  const user = await findUserByAccount(detected.type, detected.value);
  if (!user || !user.passwordHash) {
    const err = new Error("账号或密码错误");
    err.code = "AUTH";
    throw err;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const err = new Error("账号或密码错误");
    err.code = "AUTH";
    throw err;
  }
  const updated = await upsertUser({
    openid: user.openid,
    platform: user.platform || detected.type,
    nickName: user.nickName || "",
    avatarUrl: user.avatarUrl || "",
    phone: user.phone || (detected.type === "phone" ? detected.value : ""),
    email: user.email || (detected.type === "email" ? detected.value : ""),
    touchLogin: true,
  });
  return updated || publicUser(user);
}

async function loginOrRegisterPhone(phone, nickName) {
  const p = normalizePhone(phone);
  if (!p) {
    const err = new Error("手机号无效");
    err.code = "BAD_PHONE";
    throw err;
  }
  const openid = identityOpenid("phone", p);
  const existing = await findUserByAccount("phone", p);
  const display =
    String(nickName || "").trim() ||
    (existing && (existing.nickName || existing.nick_name)) ||
    `用户${p.slice(-4)}`;
  return upsertUser({
    openid: (existing && existing.openid) || openid,
    platform: "phone",
    nickName: display,
    avatarUrl: (existing && (existing.avatarUrl || existing.avatar_url)) || "",
    phone: p,
    touchLogin: true,
  });
}

async function listUsers({ limit = 50, offset = 0, q = "" } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const keyword = String(q || "").trim();

  if (db.isReady()) {
    const params = [];
    let where = "";
    if (keyword) {
      where = "WHERE openid LIKE ? OR nick_name LIKE ? OR phone LIKE ? OR email LIKE ?";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const countRows = await db.query(`SELECT COUNT(*) AS c FROM users ${where}`, params);
    const total = Number((countRows[0] && countRows[0].c) || 0);
    const rows = await db.query(
      `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
              phone, email, created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
       FROM users ${where}
       ORDER BY last_login_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    return { total, users: rows.map(publicUser), source: "mysql" };
  }

  let list = readUsersFile().map(publicUser);
  if (keyword) {
    const k = keyword.toLowerCase();
    list = list.filter(
      (u) =>
        String(u.openid || "").toLowerCase().includes(k) ||
        String(u.nickName || "").toLowerCase().includes(k) ||
        String(u.phone || "").includes(k) ||
        String(u.email || "").toLowerCase().includes(k)
    );
  }
  list.sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
  return { total: list.length, users: list.slice(off, off + lim), source: "file" };
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
      return { role: row.role, openid: row.openid, userId: row.user_id };
    }
  }
  const accountOpenid = parseUserToken(token);
  if (accountOpenid) {
    return { role: "user", openid: accountOpenid, userId: null };
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
    if (sess) req.user = { openid: sess.openid, userId: sess.userId };
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

module.exports = {
  upsertUser,
  listUsers,
  registerAccount,
  loginAccount,
  loginOrRegisterPhone,
  detectAccount,
  normalizePhone,
  normalizeEmail,
  makeUserToken,
  parseUserToken,
  createSession,
  revokeSession,
  resolveSession,
  validateAdminToken,
  validateUserToken,
  bearerToken,
  userAuthOptional,
  userAuthRequired,
  ADMIN_TTL_MS,
  USER_TTL_MS,
};
