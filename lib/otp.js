/**
 * 邮箱验证码登录（验证码存 MySQL，不落本地文件）
 */
const crypto = require("crypto");
const db = require("./db");
const authStore = require("./authStore");

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪");
    err.code = "DB";
    throw err;
  }
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(to, code) {
  const host = String(process.env.SMTP_HOST || "smtp.qq.com").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const fromRaw = String(process.env.SMTP_FROM || "").trim();
  const from = fromRaw || (user.includes("<") ? user : `呆呆网络 <${user}>`);
  const port = Number(process.env.SMTP_PORT || 465);
  if (!user || !pass) {
    const err = new Error("未配置邮件服务（SMTP_USER / SMTP_PASS）");
    err.code = "NO_SMTP";
    throw err;
  }
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    const err = new Error("服务器未安装 nodemailer，无法发邮件");
    err.code = "NO_SMTP";
    throw err;
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from,
    to,
    subject: "呆呆网络验证码",
    text: `【呆呆网络】您的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    html: `<div style="font-family:sans-serif;color:#1e3a2a">
      <p style="font-size:16px;margin:0 0 12px">呆呆网络</p>
      <p>您的验证码是</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#40916c;margin:8px 0 16px">${code}</p>
      <p style="color:#6b8f7a;font-size:13px">5 分钟内有效。如非本人操作请忽略。</p>
    </div>`,
  });
}

function otpDevMode() {
  return (
    process.env.OTP_DEV === "1" ||
    process.env.ALLOW_DEV_LOGIN === "1" ||
    process.env.NODE_ENV === "development"
  );
}

async function getOtpRow(accountKey) {
  const rows = await db.query(
    `SELECT account_key AS accountKey, code, expire_at AS expireAt, sent_at AS sentAt, ip
     FROM otp_codes WHERE account_key = ? LIMIT 1`,
    [accountKey]
  );
  return rows[0] || null;
}

async function upsertOtp(accountKey, code, expireAt, sentAt, ip) {
  await db.exec(
    `INSERT INTO otp_codes (account_key, code, expire_at, sent_at, ip)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       expire_at = VALUES(expire_at),
       sent_at = VALUES(sent_at),
       ip = VALUES(ip)`,
    [accountKey, code, expireAt, sentAt, ip || ""]
  );
}

async function deleteOtp(accountKey) {
  await db.exec("DELETE FROM otp_codes WHERE account_key = ?", [accountKey]);
}

async function sendCode(accountRaw, ip) {
  requireDb();
  const detected = authStore.detectAccount(accountRaw);
  if (!detected) {
    const err = new Error(authStore.EMAIL_ACCOUNT_HINT || "请输入支持的邮箱地址");
    err.code = "BAD_ACCOUNT";
    throw err;
  }
  const key = `${detected.type}:${detected.value}`;
  const prev = await getOtpRow(key);
  const now = Date.now();
  if (prev && now - (Number(prev.sentAt) || 0) < RESEND_MS) {
    const wait = Math.ceil((RESEND_MS - (now - Number(prev.sentAt))) / 1000);
    const err = new Error(`请 ${wait} 秒后再获取验证码`);
    err.code = "RATE";
    throw err;
  }

  const code = randomCode();
  await upsertOtp(key, code, now + CODE_TTL_MS, now, ip);

  let sent = false;
  try {
    await sendEmail(detected.value, code);
    sent = true;
  } catch (err) {
    if (err.code === "NO_SMTP") {
      console.warn("[otp] SMTP not configured, preview code for", key, code);
      return {
        ok: true,
        sent: false,
        channel: "email",
        cooldownSec: Math.floor(RESEND_MS / 1000),
        message: "未配置邮件发送，请使用下方验证码（建议配置 SMTP）",
        previewCode: code,
      };
    }
    if (!otpDevMode()) {
      await deleteOtp(key);
      throw err;
    }
    console.warn("[otp] send failed, dev echo enabled:", err.message, "code=", code);
  }

  console.log(`[otp] ${key} code=${code} sent=${sent}`);
  const out = {
    ok: true,
    sent,
    channel: "email",
    cooldownSec: Math.floor(RESEND_MS / 1000),
    message: sent ? "验证码已发送到邮箱" : "验证码已生成（开发模式）",
  };
  if (otpDevMode()) out.devCode = code;
  return out;
}

async function loginWithCode(accountRaw, codeRaw) {
  requireDb();
  const detected = authStore.detectAccount(accountRaw);
  if (!detected) {
    const err = new Error(authStore.EMAIL_ACCOUNT_HINT || "请输入支持的邮箱地址");
    err.code = "BAD_ACCOUNT";
    throw err;
  }
  const code = String(codeRaw || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    const err = new Error("请输入验证码");
    err.code = "BAD_CODE";
    throw err;
  }
  const key = `${detected.type}:${detected.value}`;
  const entry = await getOtpRow(key);
  if (!entry || Number(entry.expireAt) < Date.now()) {
    const err = new Error("验证码无效或已过期");
    err.code = "BAD_CODE";
    throw err;
  }
  if (String(entry.code) !== code) {
    const err = new Error("验证码错误");
    err.code = "BAD_CODE";
    throw err;
  }
  await deleteOtp(key);

  const existing = await authStore.findUserByAccount("email", detected.value);
  if (existing) {
    return authStore.upsertUser({
      openid: existing.openid,
      platform: "email",
      nickName: existing.nickName || existing.nick_name || detected.value.split("@")[0],
      avatarUrl: existing.avatarUrl || existing.avatar_url || "",
      email: detected.value,
      touchLogin: true,
    });
  }
  const openid = `em_${crypto.createHash("sha256").update(detected.value).digest("hex").slice(0, 24)}`;
  return authStore.upsertUser({
    openid,
    platform: "email",
    nickName: detected.value.split("@")[0],
    email: detected.value,
    touchLogin: true,
  });
}

module.exports = {
  sendCode,
  loginWithCode,
  otpDevMode,
};
