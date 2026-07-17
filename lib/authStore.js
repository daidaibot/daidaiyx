const crypto = require("crypto");
const db = require("./db");

const ADMIN_TTL_MS = 30 * 24 * 3600 * 1000;
const USER_TTL_MS = 90 * 24 * 3600 * 1000;

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪，无法读写用户数据");
    err.code = "DB";
    throw err;
  }
}

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

function normalizePhone(phone) {
  let p = String(phone || "").replace(/\s+/g, "").trim();
  if (p.startsWith("+86")) p = p.slice(3);
  if (p.startsWith("86") && p.length === 13) p = p.slice(2);
  if (!/^1\d{10}$/.test(p)) return "";
  return p;
}

/** QQ / Gmail / 网易邮箱 */
const ALLOWED_EMAIL_DOMAINS = new Set([
  "qq.com",
  "gmail.com",
  "googlemail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "vip.163.com",
  "vip.126.com",
  "188.com",
]);

const EMAIL_ACCOUNT_HINT = "请输入 QQ / Gmail / 网易邮箱（如 @qq.com、@gmail.com、@163.com）";

function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const m = e.match(/^([a-z0-9._-]{1,64})@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return "";
  if (!ALLOWED_EMAIL_DOMAINS.has(m[2])) return "";
  return e;
}

function detectAccount(account) {
  const raw = String(account || "").trim();
  if (!raw) return null;
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
    isMember: Boolean(u.isMember != null ? u.isMember : u.is_member),
    isBanned: Boolean(u.isBanned != null ? u.isBanned : u.is_banned),
    createdAt: u.createdAt || u.created_at || 0,
    updatedAt: u.updatedAt || u.updated_at || 0,
    lastLoginAt: u.lastLoginAt || u.last_login_at || 0,
  };
}

async function fetchUserByOpenid(openid) {
  requireDb();
  const rows = await db.query(
    `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
            phone, email, is_member AS isMember, is_banned AS isBanned,
            created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
     FROM users WHERE openid = ? LIMIT 1`,
    [openid]
  );
  return rows[0] || null;
}

async function upsertUser(fields) {
  requireDb();
  const openid = fields && fields.openid;
  if (!openid) return null;

  const ts = now();
  const touchLogin = fields.touchLogin !== false;
  await db.exec(
    `INSERT INTO users (openid, unionid, platform, nick_name, avatar_url, phone, email, password_hash, is_member, is_banned, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unionid = IF(VALUES(unionid) <> '', VALUES(unionid), unionid),
       platform = IF(VALUES(platform) <> '', VALUES(platform), platform),
       nick_name = IF(VALUES(nick_name) <> '', VALUES(nick_name), nick_name),
       avatar_url = IF(VALUES(avatar_url) <> '', VALUES(avatar_url), avatar_url),
       phone = IF(VALUES(phone) <> '', VALUES(phone), phone),
       email = IF(VALUES(email) <> '', VALUES(email), email),
       password_hash = IF(VALUES(password_hash) <> '', VALUES(password_hash), password_hash),
       updated_at = VALUES(updated_at),
       last_login_at = IF(?, VALUES(last_login_at), last_login_at)`,
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
      touchLogin ? ts : 0,
      touchLogin ? 1 : 0,
    ]
  );
  return publicUser(await fetchUserByOpenid(openid));
}

async function findUserByAccount(type, value) {
  requireDb();
  if (!type || !value) return null;
  const col = type === "phone" ? "phone" : "email";
  const rows = await db.query(
    `SELECT id, openid, unionid, platform, nick_name AS nickName, avatar_url AS avatarUrl,
            phone, email, password_hash AS passwordHash,
            is_member AS isMember, is_banned AS isBanned,
            created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
     FROM users WHERE ${col} = ? LIMIT 1`,
    [value]
  );
  return rows[0] || null;
}

async function registerAccount({ account, password, nickName }) {
  const detected = detectAccount(account);
  if (!detected) {
    const err = new Error(EMAIL_ACCOUNT_HINT);
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
    const err = new Error("该邮箱已注册");
    err.code = "EXISTS";
    throw err;
  }
  const openid = identityOpenid(detected.type, detected.value);
  const passwordHash = hashPassword(password);
  const display = String(nickName || "").trim() || detected.value.split("@")[0];
  return upsertUser({
    openid,
    platform: detected.type,
    nickName: display,
    email: detected.value,
    passwordHash,
    touchLogin: true,
  });
}

async function loginAccount({ account, password }) {
  const detected = detectAccount(account);
  if (!detected) {
    const err = new Error(EMAIL_ACCOUNT_HINT);
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
    email: user.email || detected.value,
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
  requireDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const keyword = String(q || "").trim();
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
            phone, email, is_member AS isMember, is_banned AS isBanned,
            created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
     FROM users ${where}
     ORDER BY last_login_at DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return { total, users: rows.map(publicUser), source: "mysql" };
}

async function setMemberByOpenid(openid, isMember) {
  requireDb();
  const oid = String(openid || "").trim();
  if (!oid) {
    const err = new Error("缺少用户标识");
    err.code = "BAD_OPENID";
    throw err;
  }
  const flag = Boolean(isMember);
  const result = await db.exec(
    `UPDATE users SET is_member = ?, updated_at = ? WHERE openid = ?`,
    [flag ? 1 : 0, now(), oid]
  );
  if (!result || Number(result.affectedRows || 0) === 0) {
    const err = new Error("用户不存在");
    err.code = "NOT_FOUND";
    throw err;
  }
  return publicUser(await fetchUserByOpenid(oid));
}

async function setBannedByOpenid(openid, isBanned) {
  requireDb();
  const oid = String(openid || "").trim();
  if (!oid) {
    const err = new Error("缺少用户标识");
    err.code = "BAD_OPENID";
    throw err;
  }
  const flag = Boolean(isBanned);
  const result = await db.exec(
    `UPDATE users SET is_banned = ?, updated_at = ? WHERE openid = ?`,
    [flag ? 1 : 0, now(), oid]
  );
  if (!result || Number(result.affectedRows || 0) === 0) {
    const err = new Error("用户不存在");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (flag) {
    await db.exec("DELETE FROM auth_sessions WHERE openid = ?", [oid]);
  }
  return publicUser(await fetchUserByOpenid(oid));
}

async function isBanned(openid) {
  const oid = String(openid || "").trim();
  if (!oid) return false;
  if (!db.isReady()) return false;
  const rows = await db.query(
    `SELECT is_banned AS isBanned FROM users WHERE openid = ? LIMIT 1`,
    [oid]
  );
  return Boolean(rows[0] && rows[0].isBanned);
}

async function isMember(openid) {
  const oid = String(openid || "").trim();
  if (!oid) return false;
  if (!db.isReady()) return false;
  const rows = await db.query(
    `SELECT is_member AS isMember FROM users WHERE openid = ? LIMIT 1`,
    [oid]
  );
  return Boolean(rows[0] && rows[0].isMember);
}

async function createSession({ token, role, openid, userId, ip, ttlMs }) {
  requireDb();
  if (!token) return false;
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
  if (!token || !db.isReady()) return;
  await db.exec("DELETE FROM auth_sessions WHERE token_hash = ?", [hashToken(token)]);
}

async function resolveSession(token) {
  if (!token || !db.isReady()) return null;
  const rows = await db.query(
    `SELECT role, openid, user_id, expires_at FROM auth_sessions WHERE token_hash = ? LIMIT 1`,
    [hashToken(token)]
  );
  const row = rows[0];
  if (row && Number(row.expires_at) > now()) {
    return { role: row.role, openid: row.openid, userId: row.user_id };
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
  if (!db.isReady()) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪，请稍后重试" } });
  }
  const sess = await validateUserToken(token);
  if (!sess || !sess.openid) {
    return res.status(401).json({ ok: false, error: { message: "登录已过期，请重新登录" } });
  }
  if (await isBanned(sess.openid)) {
    return res.status(403).json({ ok: false, error: { message: "账号已停用，请联系管理员" } });
  }
  req.user = { openid: sess.openid, userId: sess.userId };
  next();
}

module.exports = {
  upsertUser,
  listUsers,
  setMemberByOpenid,
  setBannedByOpenid,
  isMember,
  isBanned,
  registerAccount,
  loginAccount,
  loginOrRegisterPhone,
  findUserByAccount,
  detectAccount,
  normalizePhone,
  normalizeEmail,
  EMAIL_ACCOUNT_HINT,
  ALLOWED_EMAIL_DOMAINS,
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
