/**
 * 手机号 / 邮箱验证码
 * 配置：
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM  — 发邮件
 *   OTP_SMS_URL — 短信网关，POST { phone, code, minutes }
 *   OTP_DEV=1 — 响应里带回验证码（仅调试）
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const ops = require("./ops");
const authStore = require("./authStore");

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const codes = new Map(); // key -> { code, expireAt, sentAt }

function codeFile() {
  return path.join(ops.DATA_DIR, "otp-codes.json");
}

function loadDisk() {
  try {
    if (!fs.existsSync(codeFile())) return;
    const raw = JSON.parse(fs.readFileSync(codeFile(), "utf8"));
    const now = Date.now();
    Object.entries(raw || {}).forEach(([k, v]) => {
      if (v && v.expireAt > now) codes.set(k, v);
    });
  } catch {
    /* ignore */
  }
}

function saveDisk() {
  try {
    if (!fs.existsSync(ops.DATA_DIR)) fs.mkdirSync(ops.DATA_DIR, { recursive: true });
    const obj = {};
    const now = Date.now();
    for (const [k, v] of codes.entries()) {
      if (v.expireAt > now) obj[k] = v;
    }
    fs.writeFileSync(codeFile(), JSON.stringify(obj), "utf8");
  } catch {
    /* ignore */
  }
}

loadDisk();

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function httpJson(url, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const payload = JSON.stringify(body || {});
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            raw: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("短信网关超时"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function sendEmail(to, code) {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.SMTP_FROM || user || "").trim();
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host || !user || !pass || !from) {
    const err = new Error("未配置邮件服务（SMTP_HOST / SMTP_USER / SMTP_PASS）");
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
    text: `您的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    html: `<p>您的验证码是 <strong style="font-size:20px;letter-spacing:4px">${code}</strong></p><p>5 分钟内有效。如非本人操作请忽略。</p>`,
  });
}

async function sendSms(phone, code) {
  const url = String(process.env.OTP_SMS_URL || process.env.SMS_WEBHOOK_URL || "").trim();
  if (!url) {
    const err = new Error("未配置短信服务（OTP_SMS_URL）");
    err.code = "NO_SMS";
    throw err;
  }
  const result = await httpJson(url, {
    phone,
    code,
    minutes: 5,
    message: `【呆呆网络】验证码 ${code}，5分钟内有效`,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`短信发送失败 HTTP ${result.status}`);
  }
}

function otpDevMode() {
  return (
    process.env.OTP_DEV === "1" ||
    process.env.ALLOW_DEV_LOGIN === "1" ||
    process.env.NODE_ENV === "development"
  );
}

async function sendCode(accountRaw, ip) {
  const detected = authStore.detectAccount(accountRaw);
  if (!detected) {
    const err = new Error("请输入有效手机号或邮箱");
    err.code = "BAD_ACCOUNT";
    throw err;
  }
  const key = `${detected.type}:${detected.value}`;
  const prev = codes.get(key);
  const now = Date.now();
  if (prev && now - (prev.sentAt || 0) < RESEND_MS) {
    const wait = Math.ceil((RESEND_MS - (now - prev.sentAt)) / 1000);
    const err = new Error(`请 ${wait} 秒后再获取验证码`);
    err.code = "RATE";
    throw err;
  }

  const code = randomCode();
  const entry = { code, expireAt: now + CODE_TTL_MS, sentAt: now, ip: ip || "" };
  codes.set(key, entry);
  saveDisk();

  let sent = false;
  let channel = detected.type;
  try {
    if (detected.type === "email") {
      await sendEmail(detected.value, code);
      sent = true;
    } else {
      await sendSms(detected.value, code);
      sent = true;
    }
  } catch (err) {
    if (err.code === "NO_SMTP" || err.code === "NO_SMS") {
      console.warn("[otp] channel not configured, preview code for", key, code);
      return {
        ok: true,
        sent: false,
        channel,
        cooldownSec: Math.floor(RESEND_MS / 1000),
        message:
          detected.type === "email"
            ? "未配置邮件发送，请使用下方验证码（建议配置 SMTP）"
            : "未配置短信发送，请使用下方验证码，或底部微信快捷登录",
        previewCode: code,
      };
    }
    if (!otpDevMode()) {
      codes.delete(key);
      saveDisk();
      throw err;
    }
    console.warn("[otp] send failed, dev echo enabled:", err.message, "code=", code);
  }

  console.log(`[otp] ${key} code=${code} sent=${sent}`);
  const out = {
    ok: true,
    sent,
    channel,
    cooldownSec: Math.floor(RESEND_MS / 1000),
    message: sent
      ? detected.type === "email"
        ? "验证码已发送到邮箱"
        : "验证码已发送到手机"
      : "验证码已生成（开发模式）",
  };
  if (otpDevMode()) out.devCode = code;
  return out;
}

async function loginWithCode(accountRaw, codeRaw) {
  const detected = authStore.detectAccount(accountRaw);
  if (!detected) {
    const err = new Error("请输入有效手机号或邮箱");
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
  const entry = codes.get(key);
  if (!entry || entry.expireAt < Date.now()) {
    const err = new Error("验证码无效或已过期");
    err.code = "BAD_CODE";
    throw err;
  }
  if (entry.code !== code) {
    const err = new Error("验证码错误");
    err.code = "BAD_CODE";
    throw err;
  }
  codes.delete(key);
  saveDisk();

  if (detected.type === "phone") {
    return authStore.loginOrRegisterPhone(detected.value);
  }
  // email：无密码注册/登录
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
  const openid = `em_${require("crypto").createHash("sha256").update(detected.value).digest("hex").slice(0, 24)}`;
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
