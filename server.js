const path = require("path");
const fs = require("fs");
const https = require("https");
const express = require("express");
const ops = require("./lib/ops");
const imageOut = require("./lib/imageOut");
const imageJobs = require("./lib/imageJobs");
const db = require("./lib/db");
const authStore = require("./lib/authStore");
const chatStore = require("./lib/chatStore");
const cosStore = require("./lib/cosStore");
const otp = require("./lib/otp");
const usageStore = require("./lib/usageStore");
const maskStore = require("./lib/maskStore");
const blobStore = require("./lib/blobStore");
const { outboundFetch } = require("./lib/outbound");
const doubaoImage = require("./lib/doubaoImage");
const chatIntent = require("./lib/chatIntent");
const app = express();
const PORT = Number(process.env.PORT) || 80;

/** 对话上游（内部）；对外一律称「呆呆 AI」。优先读 DAIDAI_*，旧变量名仍兼容 */
const CHAT_BASE_URL = (
  process.env.DAIDAI_AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.deepseek.com"
).replace(/\/$/, "");
const DEFAULT_MODEL =
  process.env.DAIDAI_AI_MODEL || process.env.CHAT_MODEL || "deepseek-chat";

/** 生图上游（内部）；对外一律称「呆呆 Image」；默认走国外 VPS 中转 */
const IMAGE_BASE_URL = (
  process.env.DAIDAI_IMAGE_BASE_URL ||
  process.env.OPENAI_IMAGE_BASE_URL ||
  process.env.OPENAI_API_BASE ||
  "http://154.12.94.236"
).replace(/\/$/, "");
const IMAGE_MODEL =
  process.env.DAIDAI_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2";

app.use(express.json({ limit: "20mb" }));
app.use(ops.requestLogger);
app.use(maintenanceApiGate);

const WECHAT_APPID = String(
  process.env.WECHAT_APPID || process.env.WX_APPID || ""
).trim();
const WECHAT_SECRET = String(
  process.env.WECHAT_SECRET || process.env.WX_SECRET || ""
).trim();
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
/** 网页端仅本人使用：可用独立密码，默认与后台密码相同 */
const WEB_PASSWORD =
  process.env.WEB_PASSWORD || process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKENS = new Set();

/** 用 Node https 直连微信（不依赖 global fetch，便于云托管排障） */
function httpsJson(url, timeoutMs = 12000, tlsOpts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        rejectUnauthorized: tlsOpts.rejectUnauthorized !== false,
        servername: tlsOpts.servername,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode || 0, raw, data });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("连接微信超时"));
    });
    req.on("error", (err) => reject(err));
  });
}

/** 微信接口：证书异常时（云托管中间人/缺 CA）自动降级一次 */
async function weixinHttpsJson(url, timeoutMs = 12000) {
  try {
    return await httpsJson(url, timeoutMs, { rejectUnauthorized: true });
  } catch (err) {
    const msg = String((err && err.message) || err || "");
    const tlsFail =
      /self-signed|UNABLE_TO_VERIFY|CERT_|certificate/i.test(msg) ||
      err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      err.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      err.code === "CERT_HAS_EXPIRED";
    if (!tlsFail) throw err;
    console.warn("weixin TLS verify failed, retry insecure:", msg);
    return httpsJson(url, timeoutMs, { rejectUnauthorized: false });
  }
}

function httpsPostJson(url, body, timeoutMs = 12000, tlsOpts = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        timeout: timeoutMs,
        rejectUnauthorized: tlsOpts.rejectUnauthorized !== false,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode || 0, raw, data });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("连接微信超时"));
    });
    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function weixinHttpsPostJson(url, body, timeoutMs = 12000) {
  try {
    return await httpsPostJson(url, body, timeoutMs, { rejectUnauthorized: true });
  } catch (err) {
    const msg = String((err && err.message) || err || "");
    if (!/self-signed|UNABLE_TO_VERIFY|CERT_|certificate/i.test(msg)) throw err;
    return httpsPostJson(url, body, timeoutMs, { rejectUnauthorized: false });
  }
}

let _wxTokenCache = { token: "", expireAt: 0 };
async function getWechatAccessToken() {
  if (_wxTokenCache.token && Date.now() < _wxTokenCache.expireAt - 60000) {
    return _wxTokenCache.token;
  }
  if (!WECHAT_APPID || !WECHAT_SECRET) {
    throw new Error("未配置 WECHAT_APPID / WECHAT_SECRET");
  }
  const url =
    "https://api.weixin.qq.com/cgi-bin/token" +
    `?grant_type=client_credential&appid=${encodeURIComponent(WECHAT_APPID)}` +
    `&secret=${encodeURIComponent(WECHAT_SECRET)}`;
  const result = await weixinHttpsJson(url, 12000);
  const data = result.data || {};
  if (!data.access_token) {
    throw new Error(data.errmsg || "获取微信 access_token 失败");
  }
  _wxTokenCache = {
    token: data.access_token,
    expireAt: Date.now() + Number(data.expires_in || 7200) * 1000,
  };
  return _wxTokenCache.token;
}

function finishAccountLogin(res, req, user) {
  const openid = user.openid;
  if (user.isBanned) {
    return res.status(403).json({
      ok: false,
      error: { message: "账号已停用，请联系管理员" },
    });
  }
  return authStore.isBanned(openid).then((banned) => {
    if (banned) {
      return res.status(403).json({
        ok: false,
        error: { message: "账号已停用，请联系管理员" },
      });
    }
    if (!db.isReady()) {
      return res.status(503).json({
        ok: false,
        error: { message: "数据库未就绪，请稍后重试" },
      });
    }
    const token = authStore.makeUserToken(openid);
    return issueUserSession({
      token,
      openid,
      platform: user.platform || "account",
      nickName: user.nickName || "",
      avatarUrl: user.avatarUrl || "",
      ip: ops.clientIp(req),
    })
      .then(() => {
        stats.login += 1;
        ops.bumpHourly("login");
        return res.json({
          ok: true,
          openid,
          token,
          nickName: user.nickName || "",
          avatarUrl: user.avatarUrl || "",
          phone: user.phone || "",
          email: user.email || "",
          platform: user.platform || "account",
        });
      })
      .catch((err) =>
        res.status(503).json({
          ok: false,
          error: { message: (err && err.message) || "登录失败，请稍后重试" },
        })
      );
  });
}

const stats = {
  chat: 0,
  image: 0,
  imageEdit: 0,
  login: 0,
  chatFail: 0,
  imageFail: 0,
  imageEditFail: 0,
  startedAt: Date.now(),
};

function logApiError(entry, res) {
  const row = ops.pushError(
    Object.assign(
      {
        at: Date.now(),
      },
      entry || {}
    )
  );
  if (res && res.locals) {
    res.locals.errorLogged = true;
    res.locals.errorId = row && row.id;
  }
  return row;
}

function errorPayload(message, res, extra) {
  return Object.assign(
    {
      message: String(message || "服务暂时繁忙"),
      id: (res && res.locals && res.locals.errorId) || "",
    },
    extra || {}
  );
}

function sanitizePublicError(message, fallback) {
  const raw = String(message || "").trim();
  if (!raw) return fallback || "服务暂时繁忙，请稍后再试";
  return raw
    .replace(/DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|Claude|API key|platform\.openai\.com/gi, "呆呆 AI")
    .replace(/https?:\/\/[^\s)]+/gi, "[地址已隐藏]")
    .slice(0, 200);
}

function imageConfigHint() {
  return {
    hasKey: Boolean(ops.getImageKey()),
    base: IMAGE_BASE_URL,
    model: IMAGE_MODEL,
  };
}

function issueAdminToken() {
  const token = `adm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  ADMIN_TOKENS.add(token);
  if (db.isReady()) {
    authStore
      .createSession({
        token,
        role: "admin",
        openid: "admin",
        ip: "",
        ttlMs: authStore.ADMIN_TTL_MS,
      })
      .catch(() => {});
  }
  return token;
}

function adminAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: { message: "未登录或已过期" } });
  }
  if (ADMIN_TOKENS.has(token)) return next();
  authStore
    .validateAdminToken(token)
    .then((ok) => {
      if (ok) {
        ADMIN_TOKENS.add(token);
        return next();
      }
      return res.status(401).json({ error: { message: "未登录或已过期" } });
    })
    .catch(() => res.status(401).json({ error: { message: "未登录或已过期" } }));
}

function issueUserSession({ token, openid, unionid, platform, nickName, avatarUrl, phone, email, ip }) {
  if (!openid || !token) return Promise.resolve(null);
  return authStore
    .upsertUser({ openid, unionid, platform, nickName, avatarUrl, phone, email })
    .then((user) =>
      authStore
        .createSession({
          token,
          role: "user",
          openid,
          userId: user && user.id,
          ip,
          ttlMs: authStore.USER_TTL_MS,
        })
        .then(() => user)
    )
    .catch((err) => {
      console.warn("issueUserSession failed:", err && err.message);
      throw err;
    });
}

function gateProductApi(kind) {
  return (req, res, next) => {
    const settings = ops.loadSettings();
    const ip = ops.clientIp(req);
    if (settings.maintenance) {
      logApiError(
        {
          source: kind,
          message: "维护模式拦截",
          status: 503,
          path: req.path,
          ip,
        },
        res
      );
      return res.status(503).json({
        ok: false,
        maintenance: true,
        error: { message: ops.maintenanceText(settings) },
      });
    }
    if (kind === "chat" && settings.blockChat) {
      logApiError(
        {
          source: "chat",
          message: "对话服务已暂停",
          status: 503,
          path: req.path,
          ip,
        },
        res
      );
      return res.status(503).json({ error: { message: "对话服务已暂停" } });
    }
    if ((kind === "image" || kind === "imageEdit") && settings.blockImage) {
      logApiError(
        {
          source: kind,
          message: "生图服务已暂停",
          status: 503,
          path: req.path,
          ip,
        },
        res
      );
      return res.status(503).json({ error: { message: "生图服务已暂停" } });
    }
    if (!ops.checkRateLimit(ip, settings.rateLimitPerMin)) {
      logApiError(
        {
          source: kind,
          message: "请求过于频繁",
          status: 429,
          path: req.path,
          ip,
        },
        res
      );
      return res.status(429).json({ error: { message: "请求过于频繁，请稍后再试" } });
    }
    next();
  };
}

/** 维护模式：拦住业务 API（管理后台除外） */
function maintenanceApiGate(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/admin")) return next();
  if (req.path === "/api/public/status" || req.path === "/api/public/diag-wechat" || req.path === "/health" || req.path === "/api/report-error") {
    return next();
  }
  if (req.path.startsWith("/api/image/file/")) return next();
  if (req.path.startsWith("/api/image/job/")) return next();
  if (req.path.startsWith("/api/avatar/")) return next();
  const settings = ops.loadSettings();
  if (!settings.maintenance) return next();
  return res.status(503).json({
    ok: false,
    maintenance: true,
    error: { message: ops.maintenanceText(settings) },
  });
}

function maintenancePageHtml(message) {
  const msg = String(message || "呆呆 AI 维护中，请稍后再试")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>维护中 · 呆呆网络</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:PingFang SC,Microsoft YaHei,sans-serif;background:linear-gradient(180deg,#fff,#eef8f1);color:#1e3a2a;text-align:center;padding:24px}
.card{max-width:420px}.brand{color:#40916c;font-weight:700;letter-spacing:.12em;margin-bottom:12px}.msg{font-size:18px;line-height:1.6;margin:16px 0}</style></head>
<body><div class="card"><div class="brand">呆呆网络</div><h1>维护中</h1><p class="msg">${msg}</p></div></body></html>`;
}

/** 维护模式：拦住网站页面（后台除外） */
function maintenanceSiteGate(req, res, next) {
  if (req.path.startsWith("/admin")) return next();
  if (req.path.startsWith("/api/")) return next();
  const settings = ops.loadSettings();
  if (!settings.maintenance) return next();
  const accept = String(req.headers.accept || "");
  if (req.method === "GET" && (accept.includes("text/html") || req.path.endsWith(".html") || req.path === "/" || !path.extname(req.path))) {
    return res.status(503).type("html").send(maintenancePageHtml(ops.maintenanceText(settings)));
  }
  next();
}

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: { message: "未配置 ADMIN_PASSWORD，无法使用后台" },
    });
  }
  const password = String((req.body && req.body.password) || "");
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: { message: "密码错误" } });
  }
  const token = issueAdminToken();
  res.json({ ok: true, token });
});

app.post("/api/admin/logout", adminAuth, async (req, res) => {
  const token = authStore.bearerToken(req);
  ADMIN_TOKENS.delete(token);
  await authStore.revokeSession(token);
  res.json({ ok: true });
});

app.get("/api/admin/users", adminAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const q = String(req.query.q || "").trim();
    const data = await authStore.listUsers({ limit, offset, q });
    res.json({
      ok: true,
      total: data.total,
      users: data.users,
      source: data.source,
      dbReady: db.isReady(),
    });
  } catch (err) {
    console.error("admin users error:", err);
    res.status(500).json({ ok: false, error: { message: err.message || "读取用户失败" } });
  }
});

/** 后台设置会员：仅管理员，小程序端不展示会员标识 */
app.post("/api/admin/users/member", adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const openid = String(body.openid || "").trim();
    const isMember = Boolean(body.isMember);
    const user = await authStore.setMemberByOpenid(openid, isMember);
    res.json({ ok: true, user });
  } catch (err) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "BAD_OPENID" ? 400 : 500;
    res.status(status).json({ ok: false, error: { message: err.message || "设置失败" } });
  }
});

/** 封禁 / 解封用户 */
app.post("/api/admin/users/ban", adminAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const openid = String(body.openid || "").trim();
    const isBanned = Boolean(body.isBanned);
    const user = await authStore.setBannedByOpenid(openid, isBanned);
    res.json({ ok: true, user });
  } catch (err) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "BAD_OPENID" ? 400 : 500;
    res.status(status).json({ ok: false, error: { message: err.message || "操作失败" } });
  }
});

/** 用户用量统计 */
app.get("/api/admin/users/:openid/stats", adminAuth, async (req, res) => {
  try {
    const openid = String(req.params.openid || "").trim();
    const days = Number(req.query.days) || 7;
    const statsData = await usageStore.getUserStats(openid, days);
    res.json({ ok: true, ...statsData });
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message || "读取失败" } });
  }
});

/** 用户会话列表 */
app.get("/api/admin/users/:openid/sessions", adminAuth, async (req, res) => {
  try {
    const openid = String(req.params.openid || "").trim();
    const sessions = await chatStore.listSessions(openid);
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message || "读取失败" } });
  }
});

/** 用户某条会话详情 */
app.get("/api/admin/users/:openid/sessions/:sessionId", adminAuth, async (req, res) => {
  try {
    const openid = String(req.params.openid || "").trim();
    const sessionId = String(req.params.sessionId || "").trim();
    const session = await chatStore.getSession(openid, sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: { message: "会话不存在" } });
    }
    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message || "读取失败" } });
  }
});

/** 运营告警：额度用尽 / 生图失败偏多 / 对话偏高等 */
app.get("/api/admin/alerts", adminAuth, async (_req, res) => {
  try {
    const data = await usageStore.buildAlerts();
    const todayUsage = await usageStore.listTodayUsage(50);
    res.json({ ok: true, ...data, todayUsage });
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message || "读取失败" } });
  }
});

app.get("/api/admin/overview", adminAuth, async (_req, res) => {
  const settings = ops.loadSettings();
  const system = ops.getSystemInfo();
  const sec = ops.secretsStatus();
  const hourly = await ops.getHourlySeriesAsync(24);

  // 优先用数据库累计值（跨重启持久），仅当库不可用时回退到本次运行的内存计数
  let statsOut = {
    chat: stats.chat,
    image: stats.image,
    imageEdit: stats.imageEdit,
    login: stats.login,
    chatFail: stats.chatFail,
    imageFail: stats.imageFail,
    imageEditFail: stats.imageEditFail,
  };
  let statsSource = "memory";
  try {
    if (db.isReady()) {
      const totals = await usageStore.getTotals();
      const metric = await ops.getMetricTotalsAsync();
      statsOut = {
        chat: totals.chat,
        image: totals.image,
        imageEdit: totals.imageEdit,
        imageTotal: totals.imageTotal,
        chatFail: totals.chatFail,
        imageFail: totals.imageFail,
        imageEditFail: totals.imageEditFail,
        login: metric ? metric.login : stats.login,
      };
      statsSource = "mysql";
    }
  } catch (err) {
    console.warn("overview totals fallback:", err && err.message);
  }

  res.json({
    ok: true,
    brand: "呆呆网络",
    product: "呆呆 AI",
    uptimeSec: Math.floor((Date.now() - stats.startedAt) / 1000),
    statsSource,
    stats: statsOut,
    hourly,
    system,
    settings: {
      maintenance: settings.maintenance,
      maintenanceMessage: settings.maintenanceMessage,
      announce: settings.announce,
      rateLimitPerMin: settings.rateLimitPerMin,
      blockChat: settings.blockChat,
      blockImage: settings.blockImage,
      notes: settings.notes,
      publicApiBase: settings.publicApiBase || "",
    },
    publicApiBase: ops.getPublicApiBase(settings),
    chatConfigured: sec.chatConfigured,
    imageConfigured: sec.imageConfigured,
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
    webPasswordConfigured: Boolean(WEB_PASSWORD),
    adminConfigured: Boolean(ADMIN_PASSWORD),
    allowDevLogin: ALLOW_DEV_LOGIN,
    upstream: {
      chatBase: CHAT_BASE_URL,
      imageBase: IMAGE_BASE_URL,
      imageProvider: "openai",
      visionProvider: "doubao",
      chatModel: DEFAULT_MODEL,
      imageModel: IMAGE_MODEL,
      visionModel: doubaoImage.visionModel(),
      visionConfigured: Boolean(ops.getDoubaoKey()),
    },
    models: {
      chat: "呆呆 AI",
      image: "呆呆 Image",
      chatReady: sec.chatConfigured,
      imageReady: sec.imageConfigured,
    },
    secrets: {
      chatFromAdmin: sec.chatFromAdmin,
      imageFromAdmin: sec.imageFromAdmin,
      chatMasked: sec.chatMasked,
      imageMasked: sec.imageMasked,
    },
  });
});

app.get("/api/admin/logs", adminAuth, async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 80);
  const logs = await ops.getLogsAsync(limit);
  res.json({ ok: true, logs });
});

app.get("/api/admin/errors", adminAuth, async (req, res) => {
  const limit = Math.min(150, Number(req.query.limit) || 60);
  const errors = await ops.getErrorsAsync(limit);
  res.json({
    ok: true,
    errors,
    meta: {
      count: errors.length,
      storage: "mysql",
      tip:
        errors.length === 0
          ? "错误日志存于 MySQL error_logs 表"
          : "",
    },
  });
});

app.post("/api/admin/logs/clear", adminAuth, async (_req, res) => {
  await ops.clearLogs();
  res.json({ ok: true });
});

/** 前端/小程序上报错误（用户看到的「处理失败」也会进后台错误日志） */
app.post("/api/report-error", (req, res) => {
  const body = req.body || {};
  logApiError(
    {
      source: String(body.source || "client").slice(0, 32),
      message: String(body.message || "客户端上报错误").slice(0, 500),
      status: body.status || "",
      path: String(body.path || req.path).slice(0, 120),
      detail: String(body.detail || "").slice(0, 500),
      ip: ops.clientIp(req),
    },
    res
  );
  res.json({ ok: true });
});

app.get("/api/admin/settings", adminAuth, (_req, res) => {
  res.json({ ok: true, settings: ops.loadSettings() });
});

app.put("/api/admin/settings", adminAuth, (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (typeof body.maintenance === "boolean") patch.maintenance = body.maintenance;
  if (typeof body.maintenanceMessage === "string") {
    patch.maintenanceMessage = body.maintenanceMessage.slice(0, 200);
  }
  if (typeof body.announce === "string") patch.announce = body.announce.slice(0, 500);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
  if (typeof body.publicApiBase === "string") {
    patch.publicApiBase = body.publicApiBase.trim().replace(/\/$/, "").slice(0, 200);
  }
  if (body.rateLimitPerMin != null) {
    patch.rateLimitPerMin = Math.max(10, Math.min(5000, Number(body.rateLimitPerMin) || 120));
  }
  if (typeof body.blockChat === "boolean") patch.blockChat = body.blockChat;
  if (typeof body.blockImage === "boolean") patch.blockImage = body.blockImage;
  const settings = ops.saveSettings(patch);
  res.json({ ok: true, settings });
});

app.get("/api/admin/secrets", adminAuth, (_req, res) => {
  res.json({ ok: true, ...ops.secretsStatus() });
});

app.put("/api/admin/secrets", adminAuth, (req, res) => {
  const body = req.body || {};
  ops.saveSecrets({
    chatKey: typeof body.chatKey === "string" ? body.chatKey : undefined,
    imageKey: typeof body.imageKey === "string" ? body.imageKey : undefined,
    clearChat: Boolean(body.clearChat),
    clearImage: Boolean(body.clearImage),
  });
  res.json({ ok: true, ...ops.secretsStatus() });
});

app.get("/api/admin/config", adminAuth, (_req, res) => {
  const sec = ops.secretsStatus();
  const settings = ops.loadSettings();
  res.json({
    ok: true,
    env: {
      "呆呆 AI 密钥": sec.chatConfigured
        ? sec.chatFromAdmin
          ? "已在后台配置"
          : "已由环境变量提供"
        : "未配置",
      "呆呆 Image 密钥": sec.imageConfigured
        ? sec.imageFromAdmin
          ? "已在后台配置"
          : "已由环境变量提供"
        : "未配置",
      小程序登录: WECHAT_APPID && WECHAT_SECRET ? "已配置" : "未配置",
      管理密码: ADMIN_PASSWORD ? "已配置" : "未配置",
      网页站长密码: WEB_PASSWORD ? "已配置" : "未配置",
      小程序对接域名: ops.getPublicApiBase(settings) || "未填写",
      对话上游: CHAT_BASE_URL,
      生图上游: IMAGE_BASE_URL,
      生图模型: IMAGE_MODEL,
      开发假登录: ALLOW_DEV_LOGIN ? "开启" : "关闭",
    },
    masked: {
      "呆呆 AI": sec.chatMasked,
      "呆呆 Image": sec.imageMasked,
      小程序AppID: ops.maskSecret(WECHAT_APPID),
    },
  });
});

app.get("/api/admin/routes", adminAuth, (_req, res) => {
  res.json({
    ok: true,
    routes: [
      { method: "POST", path: "/api/auth/login", desc: "小程序微信登录" },
      { method: "POST", path: "/api/auth/web-login", desc: "网页站长通行" },
      { method: "GET", path: "/api/public/status", desc: "公开状态/公告" },
      { method: "POST", path: "/api/chat/intent", desc: "对话意向分析（生图/改图/聊天）" },
      { method: "POST", path: "/api/chat", desc: "对话代理" },
      { method: "POST", path: "/api/image", desc: "生图" },
      { method: "POST", path: "/api/image/edit", desc: "改图" },
      { method: "POST", path: "/api/vision", desc: "识图（豆包视觉）" },
      { method: "GET", path: "/api/admin/users", desc: "用户列表" },
      { method: "POST", path: "/api/admin/users/member", desc: "设置会员（后台）" },
      { method: "GET", path: "/health", desc: "健康检查" },
      { method: "GET", path: "/admin/", desc: "管理后台" },
      { method: "GET", path: "/", desc: "同款网站首页" },
      { method: "GET", path: "/chat.html", desc: "网页聊天（站长）" },
    ],
  });
});

app.post("/api/admin/probe", adminAuth, async (req, res) => {
  const kind = String((req.body && req.body.kind) || "chat");
  const started = Date.now();
  try {
    if (kind === "chat") {
      const chatKey = ops.getChatKey();
      if (!chatKey) {
        return res.status(503).json({ ok: false, error: "未配置呆呆 AI 密钥" });
      }
      const upstream = await fetch(`${CHAT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chatKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: "你是呆呆 AI，只回复「探测成功」四个字。" },
            { role: "user", content: "ping" },
          ],
          max_tokens: 20,
          stream: false,
        }),
      });
      const data = await upstream.json().catch(() => ({}));
      let text = data?.choices?.[0]?.message?.content || "";
      let errMsg = upstream.ok ? "" : data?.error?.message || "探测失败";
      errMsg = String(errMsg).replace(
        /DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|Claude|API key/gi,
        "呆呆 AI"
      );
      return res.json({
        ok: upstream.ok,
        kind,
        ms: Date.now() - started,
        status: upstream.status,
        preview: String(text).slice(0, 80) || (upstream.ok ? "呆呆 AI 连通" : ""),
        error: errMsg,
      });
    }
    if (kind === "wechat") {
      if (!WECHAT_APPID || !WECHAT_SECRET) {
        return res.json({
          ok: false,
          kind,
          ms: Date.now() - started,
          preview: WECHAT_APPID ? `AppID ${ops.maskSecret(WECHAT_APPID)}` : "未配置",
          error: "缺少 WECHAT_APPID / WECHAT_SECRET",
        });
      }
      try {
        const url =
          "https://api.weixin.qq.com/sns/jscode2session" +
          `?appid=${encodeURIComponent(WECHAT_APPID)}` +
          `&secret=${encodeURIComponent(WECHAT_SECRET)}` +
          "&js_code=probe_invalid_code&grant_type=authorization_code";
        const result = await weixinHttpsJson(url, 12000);
        const errcode = result.data && result.data.errcode;
        // 能拿到微信 JSON 就说明出网 + Secret 已被微信受理（无效 code 常见 40029）
        const reachable = Boolean(result.data);
        const secretLikelyOk = errcode !== 40125 && errcode !== 40013;
        return res.json({
          ok: reachable && secretLikelyOk,
          kind,
          ms: Date.now() - started,
          preview: reachable
            ? `已连通微信 errcode=${errcode || "?"}（探测用无效 code，属正常）`
            : "微信无 JSON 响应",
          error: !reachable
            ? `出网异常 HTTP ${result.status}`
            : errcode === 40125
              ? "AppSecret 无效"
              : errcode === 40013
                ? "AppID 无效"
                : "",
          errcode: errcode || null,
        });
      } catch (err) {
        return res.json({
          ok: false,
          kind,
          ms: Date.now() - started,
          preview: "",
          error: err.message || "无法连接 api.weixin.qq.com",
        });
      }
    }
    if (kind === "image") {
      const imageKey = ops.getImageKey();
      if (!imageKey) {
        logApiError(
          {
            source: "probe-image",
            message: "未配置呆呆 Image 密钥",
            status: 503,
            path: "/api/admin/probe",
            detail: `base=${IMAGE_BASE_URL} model=${IMAGE_MODEL}`,
          },
          res
        );
        return res.json({
          ok: false,
          kind,
          ms: Date.now() - started,
          preview: "",
          error: "未配置呆呆 Image 密钥",
          base: IMAGE_BASE_URL,
          model: IMAGE_MODEL,
        });
      }
      // 用 /v1/models 真连上游（不扣生图费）
      const upstream = await outboundFetch(`${IMAGE_BASE_URL}/v1/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${imageKey}` },
        signal: AbortSignal.timeout(25000),
      });
      const raw = await upstream.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      let errMsg = upstream.ok
        ? ""
        : data?.error?.message || raw.slice(0, 240) || `探测失败 HTTP ${upstream.status}`;
      if (!upstream.ok) {
        logApiError(
          {
            source: "probe-image",
            message: errMsg,
            status: upstream.status,
            path: "/api/admin/probe",
            detail: `base=${IMAGE_BASE_URL} model=${IMAGE_MODEL}`,
          },
          res
        );
      }
      const modelCount = Array.isArray(data?.data) ? data.data.length : 0;
      return res.json({
        ok: upstream.ok,
        kind,
        ms: Date.now() - started,
        status: upstream.status,
        preview: upstream.ok
          ? `上游可达 · ${IMAGE_BASE_URL} · 模型列表 ${modelCount} 项 · 目标模型 ${IMAGE_MODEL}`
          : "",
        error: errMsg,
        base: IMAGE_BASE_URL,
        model: IMAGE_MODEL,
      });
    }
    return res.status(400).json({ ok: false, error: "未知探测类型" });
  } catch (err) {
    ops.pushError({
      source: "probe",
      message: err.message || String(err),
      status: 502,
      path: "/api/admin/probe",
      detail: `kind=${kind}`,
    });
    return res.status(502).json({
      ok: false,
      kind,
      ms: Date.now() - started,
      error: err.message || "探测失败",
    });
  }
});

app.get("/api/public/status", (_req, res) => {
  const settings = ops.loadSettings();
  const chatReady = Boolean(ops.getChatKey());
  const imageReady = Boolean(ops.getImageKey());
  res.json({
    ok: true,
    brand: "呆呆网络",
    product: "呆呆 AI",
    imageProduct: "呆呆 Image",
    maintenance: Boolean(settings.maintenance),
    message: settings.maintenance ? ops.maintenanceText(settings) : "",
    announce: settings.announce || "",
    apiBase: ops.getPublicApiBase(settings),
    chatReady: chatReady && !settings.blockChat && !settings.maintenance,
    imageReady: imageReady && !settings.blockImage && !settings.maintenance,
  });
});

/** 不泄露 Secret：只测云托管能否访问微信登录域名 */
app.get("/api/public/diag-wechat", async (_req, res) => {
  const started = Date.now();
  try {
    const result = await weixinHttpsJson("https://api.weixin.qq.com/", 10000);
    return res.json({
      ok: true,
      reachable: true,
      ms: Date.now() - started,
      httpStatus: result.status,
      configured: Boolean(WECHAT_APPID && WECHAT_SECRET),
      appIdPreview: WECHAT_APPID ? ops.maskSecret(WECHAT_APPID) : "",
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reachable: false,
      ms: Date.now() - started,
      configured: Boolean(WECHAT_APPID && WECHAT_SECRET),
      appIdPreview: WECHAT_APPID ? ops.maskSecret(WECHAT_APPID) : "",
      error: err.message || String(err),
    });
  }
});

function hashCode(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}

function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (host) return `${proto}://${host}`;
  return String(ops.getPublicApiBase(ops.loadSettings()) || "").replace(/\/$/, "") || "";
}

async function saveUserAvatar(openid, avatarBase64) {
  const raw = String(avatarBase64 || "").replace(/^data:image\/\w+;base64,/, "").trim();
  if (!openid || !raw || !db.isReady()) return "";
  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return "";
  }
  if (!buf.length || buf.length > 800 * 1024) return "";
  const safe = String(openid).replace(/[^\w.-]/g, "_").slice(0, 80);
  const id = `av_${safe}`;
  try {
    await blobStore.saveBlob({
      id,
      kind: "avatar",
      mime: "image/jpeg",
      data: buf,
    });
    return safe;
  } catch (e) {
    console.warn("saveUserAvatar failed:", e && e.message);
    return "";
  }
}

/**
 * 发送邮箱验证码
 */
app.post("/api/auth/send-code", async (req, res) => {
  try {
    const account = (req.body && (req.body.account || req.body.email)) || "";
    const data = await otp.sendCode(account, ops.clientIp(req));
    return res.json(data);
  } catch (err) {
    const status =
      err.code === "RATE"
        ? 429
        : err.code === "BAD_ACCOUNT"
          ? 400
          : err.code === "NO_SMTP"
            ? 503
            : 500;
    return res.status(status).json({ ok: false, error: { message: err.message || "发送失败" } });
  }
});

/**
 * 邮箱验证码登录（未注册自动注册）
 */
app.post("/api/auth/code-login", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await otp.loginWithCode(body.account || body.email, body.code);
    return finishAccountLogin(res, req, user);
  } catch (err) {
    const status = err.code === "BAD_ACCOUNT" || err.code === "BAD_CODE" ? 401 : 500;
    return res.status(status).json({ ok: false, error: { message: err.message || "登录失败" } });
  }
});

/**
 * 邮箱 + 密码：注册
 */
app.post("/api/auth/register", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await authStore.registerAccount({
      account: body.account || body.email,
      password: body.password,
      nickName: body.nickName,
    });
    return finishAccountLogin(res, req, user);
  } catch (err) {
    const status = err.code === "EXISTS" ? 409 : err.code === "BAD_ACCOUNT" || err.code === "BAD_PASSWORD" ? 400 : 500;
    return res.status(status).json({ ok: false, error: { message: err.message || "注册失败" } });
  }
});

/**
 * 邮箱 + 密码：登录
 */
app.post("/api/auth/account-login", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await authStore.loginAccount({
      account: body.account || body.email,
      password: body.password,
    });
    return finishAccountLogin(res, req, user);
  } catch (err) {
    const status = err.code === "AUTH" || err.code === "BAD_ACCOUNT" ? 401 : 500;
    return res.status(status).json({ ok: false, error: { message: err.message || "登录失败" } });
  }
});

/** 个人主体不可用：已停用微信手机号登录 */
app.post("/api/auth/phone-login", (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: { message: "已停用手机号登录，请使用邮箱验证码登录" },
  });
});

/**
 * 小程序登录：wx.login code → jscode2session（旧流程保留兼容）
 * 必须配置 WECHAT_APPID + WECHAT_SECRET；禁止默认假登录
 * 仅当 ALLOW_DEV_LOGIN=1 时才允许开发态回落
 */
app.post("/api/auth/login", async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || "").trim();
  if (!code) {
    return res.status(400).json({ ok: false, error: { message: "缺少微信登录凭证" } });
  }

  const nickName = String(body.nickName || "").trim() || "微信用户";
  let avatarUrl = String(body.avatarUrl || "").trim();
  const avatarBase64 = body.avatarBase64 || "";

  try {
    if (!WECHAT_APPID || !WECHAT_SECRET) {
      if (!ALLOW_DEV_LOGIN) {
        return res.status(503).json({
          ok: false,
          error: {
            message: "未配置微信小程序登录（WECHAT_APPID / WECHAT_SECRET）",
          },
        });
      }
      const openid = `dev_${hashCode(code)}`;
      if (await authStore.isBanned(openid)) {
        return res.status(403).json({
          ok: false,
          error: { message: "账号已停用，请联系管理员" },
        });
      }
      const token = `dev_${openid}`;
      const saved = await saveUserAvatar(openid, avatarBase64);
      if (saved) {
        const origin = publicOrigin(req);
        avatarUrl = origin ? `${origin}/api/avatar/${saved}` : `/api/avatar/${saved}`;
      }
      stats.login += 1;
      ops.bumpHourly("login");
      await issueUserSession({
        token,
        openid,
        platform: "dev",
        nickName,
        avatarUrl,
        ip: ops.clientIp(req),
      });
      return res.json({
        ok: true,
        openid,
        token,
        nickName,
        avatarUrl,
        dev: true,
      });
    }

    const url =
      "https://api.weixin.qq.com/sns/jscode2session" +
      `?appid=${encodeURIComponent(WECHAT_APPID)}` +
      `&secret=${encodeURIComponent(WECHAT_SECRET)}` +
      `&js_code=${encodeURIComponent(code)}` +
      "&grant_type=authorization_code";
    let data = {};
    try {
      const result = await weixinHttpsJson(url, 12000);
      data = result.data || {};
      if (!result.data) {
        console.error("jscode2session non-json:", result.status, result.raw.slice(0, 200));
        ops.pushError({
          source: "auth",
          message: `jscode2session 非 JSON HTTP ${result.status}`,
        });
        return res.status(502).json({
          ok: false,
          error: { message: "微信登录接口异常，请稍后再试" },
        });
      }
    } catch (netErr) {
      console.error("jscode2session network error:", netErr);
      ops.pushError({
        source: "auth",
        message: `无法连接微信登录接口: ${netErr.message || netErr}`,
      });
      return res.status(502).json({
        ok: false,
        error: {
          message: "服务器无法连接微信登录接口，请检查云托管出网后重试",
        },
      });
    }
    if (!data.openid) {
      console.error("jscode2session failed:", data);
      const codeHint =
        data.errcode === 40125
          ? "AppSecret 无效，请在云托管核对 WECHAT_SECRET"
          : data.errcode === 40013
            ? "AppID 无效，请核对 WECHAT_APPID 是否与小程序一致"
            : data.errcode === 40163 || data.errcode === 40029
              ? "登录凭证已失效，请重试"
              : "";
      ops.pushError({
        source: "auth",
        message: `jscode2session 失败 errcode=${data.errcode || "?"} ${data.errmsg || ""}`,
      });
      return res.status(401).json({
        ok: false,
        error: {
          message: codeHint || "微信授权失败，请返回重试",
        },
      });
    }
    const saved = await saveUserAvatar(data.openid, avatarBase64);
    if (saved) {
      const origin = publicOrigin(req);
      avatarUrl = origin ? `${origin}/api/avatar/${saved}` : `/api/avatar/${saved}`;
    }
    if (await authStore.isBanned(data.openid)) {
      return res.status(403).json({
        ok: false,
        error: { message: "账号已停用，请联系管理员" },
      });
    }
    stats.login += 1;
    ops.bumpHourly("login");
    const token = `wx_${data.openid}_${hashCode(data.session_key || code)}`;
    await issueUserSession({
      token,
      openid: data.openid,
      unionid: data.unionid || "",
      platform: "wechat",
      nickName,
      avatarUrl,
      ip: ops.clientIp(req),
    });
    return res.json({
      ok: true,
      openid: data.openid,
      unionid: data.unionid || "",
      token,
      nickName,
      avatarUrl,
    });
  } catch (err) {
    console.error("auth login error:", err);
    ops.pushError({ source: "auth", message: err.message || String(err) });
    return res.status(502).json({
      ok: false,
      error: { message: "登录服务繁忙，请稍后再试" },
    });
  }
});

app.get("/api/avatar/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/[^\w.-]/g, "").slice(0, 80);
  if (!id) return res.status(404).end();
  try {
    const hit = await blobStore.getBlob(`av_${id}`);
    if (!hit || !hit.data || !hit.data.length) {
      return res.status(404).json({ ok: false, error: { message: "头像不存在" } });
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type(hit.mime || "image/jpeg");
    return res.send(hit.data);
  } catch (e) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪" } });
  }
});

/**
 * 网页端仅本人使用：密码通行（默认与 ADMIN_PASSWORD 相同）
 * 普通用户请走小程序微信登录
 */
app.post("/api/auth/web-login", async (req, res) => {
  if (!WEB_PASSWORD) {
    return res.status(503).json({
      ok: false,
      error: { message: "未配置网页通行密码（WEB_PASSWORD 或 ADMIN_PASSWORD）" },
    });
  }
  const password = String((req.body && req.body.password) || "");
  if (!password || password !== WEB_PASSWORD) {
    return res.status(401).json({ ok: false, error: { message: "密码错误" } });
  }
  if (!db.isReady()) {
    return res.status(503).json({
      ok: false,
      error: { message: "数据库未就绪，请稍后重试" },
    });
  }
  const openid = "web_owner";
  const token = `web_${openid}_${hashCode(password + Date.now())}`;
  try {
    await issueUserSession({
      token,
      openid,
      platform: "web",
      nickName: "站长",
      avatarUrl: "",
      ip: ops.clientIp(req),
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: { message: (err && err.message) || "登录失败" },
    });
  }
  stats.login += 1;
  ops.bumpHourly("login");
  return res.json({
    ok: true,
    openid,
    token,
    nickName: "站长",
    avatarUrl: "",
  });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({
    ok: true,
    miniProgramWechatLogin: Boolean(WECHAT_APPID && WECHAT_SECRET),
    webPasswordLogin: Boolean(WEB_PASSWORD),
    allowDevLogin: ALLOW_DEV_LOGIN,
    dbReady: db.isReady(),
    dbConfigured: db.isConfigured(),
  });
});

/** 聊天记录：列表 */
app.get("/api/chat/sessions", authStore.userAuthRequired, async (req, res) => {
  if (!db.isReady()) {
    return res.json({ ok: true, sessions: [], dbReady: false });
  }
  const sessions = await chatStore.listSessions(req.user.openid);
  res.json({ ok: true, sessions, dbReady: true });
});

/** 聊天记录：读取单个会话 */
app.get("/api/chat/sessions/:id", authStore.userAuthRequired, async (req, res) => {
  if (!db.isReady()) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪" } });
  }
  const session = await chatStore.getSession(req.user.openid, req.params.id);
  if (!session) {
    return res.status(404).json({ ok: false, error: { message: "会话不存在" } });
  }
  res.json({ ok: true, session });
});

/** 聊天记录：保存/更新会话 */
app.put("/api/chat/sessions/:id", authStore.userAuthRequired, async (req, res) => {
  if (!db.isReady()) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪" } });
  }
  const body = req.body || {};
  const sessions = await chatStore.saveSession(req.user.openid, {
    id: req.params.id,
    title: body.title,
    preview: body.preview,
    messages: body.messages,
    meta: body.meta,
  });
  res.json({ ok: true, sessions });
});

/** 聊天记录：删除会话 */
app.delete("/api/chat/sessions/:id", authStore.userAuthRequired, async (req, res) => {
  if (!db.isReady()) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪" } });
  }
  const sessions = await chatStore.removeSession(req.user.openid, req.params.id);
  res.json({ ok: true, sessions });
});

/** 聊天记录：批量同步（客户端迁移本地历史） */
app.post("/api/chat/sync", authStore.userAuthRequired, async (req, res) => {
  if (!db.isReady()) {
    return res.status(503).json({ ok: false, error: { message: "数据库未就绪" } });
  }
  const list = Array.isArray(req.body && req.body.sessions) ? req.body.sessions : [];
  for (const item of list.slice(0, 40)) {
    if (!item || !item.id) continue;
    await chatStore.saveSession(req.user.openid, item);
  }
  const sessions = await chatStore.listSessions(req.user.openid);
  res.json({ ok: true, sessions });
});

/** 自定义面具：列表 / 保存 / 删除（仅数据库） */
app.get("/api/masks", authStore.userAuthRequired, async (req, res) => {
  try {
    const masks = await maskStore.listMasks(req.user.openid);
    res.json({ ok: true, masks });
  } catch (err) {
    res.status(503).json({ ok: false, error: { message: (err && err.message) || "数据库未就绪" } });
  }
});

app.put("/api/masks/:id", authStore.userAuthRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const masks = await maskStore.saveMask(req.user.openid, {
      id: req.params.id,
      name: body.name,
      emoji: body.emoji,
      desc: body.desc,
      prompt: body.prompt,
      hello: body.hello,
    });
    res.json({ ok: true, masks });
  } catch (err) {
    const status = err.code === "BAD" ? 400 : 503;
    res.status(status).json({ ok: false, error: { message: (err && err.message) || "保存失败" } });
  }
});

app.delete("/api/masks/:id", authStore.userAuthRequired, async (req, res) => {
  try {
    const masks = await maskStore.removeMask(req.user.openid, req.params.id);
    res.json({ ok: true, masks });
  } catch (err) {
    res.status(503).json({ ok: false, error: { message: (err && err.message) || "删除失败" } });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "daidaiyx",
    brand: "呆呆网络",
    chatConfigured: Boolean(ops.getChatKey()),
    imageConfigured: Boolean(ops.getImageKey()),
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
    dbReady: db.isReady(),
    dbConfigured: db.isConfigured(),
    dbConfigSource: db.getConfigSource ? db.getConfigSource() : "",
    dbError: db.getInitError(),
    cosConfigured: cosStore.isConfigured(),
  });
});

app.get("/api/chat/health", (_req, res) => {
  if (!ops.getChatKey()) {
    return res.status(503).json({
      ok: false,
      message: "呆呆 AI 对话服务未就绪",
    });
  }
  res.json({ ok: true, product: "呆呆 AI" });
});

/** 我的资料：昵称/头像/会员身份/今日生图额度（小程序个人卡片用） */
app.get("/api/me", authStore.userAuthRequired, async (req, res) => {
  try {
    const openid = req.user.openid;
    const [row, stats] = await Promise.all([
      authStore.fetchUserByOpenid(openid),
      usageStore.getUserStats(openid, 1),
    ]);
    if (!row) {
      return res.status(404).json({ ok: false, error: { message: "用户不存在" } });
    }
    const user = authStore.publicUser(row);
    res.json({
      ok: true,
      user: {
        openid: user.openid,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
        email: user.email,
        isMember: user.isMember,
        createdAt: user.createdAt,
      },
      imageQuota: (stats && stats.imageQuota) || null,
      today: (stats && stats.today) || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: { message: err.message || "读取失败" } });
  }
});

/** 用 DeepSeek 分析用户是否有生图/改图意向（非关键词规则） */
app.post("/api/chat/intent", authStore.userAuthRequired, gateProductApi("chat"), async (req, res) => {
  const chatKey = ops.getChatKey();
  if (!chatKey) {
    return res.status(503).json({
      ok: false,
      error: { message: "呆呆 AI 对话服务未就绪" },
    });
  }
  const body = req.body || {};
  const text = String(body.text || "").trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: { message: "text 不能为空" } });
  }
  const hasRecentImage = Boolean(body.hasRecentImage);
  try {
    const result = await chatIntent.analyzeUserIntent({
      text,
      hasRecentImage,
      chatKey,
      chatBaseUrl: CHAT_BASE_URL,
      model: DEFAULT_MODEL,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.warn("chat intent error:", err && err.message);
    res.status(502).json({
      ok: false,
      error: { message: (err && err.message) || "意图分析失败" },
    });
  }
});

app.post("/api/chat", authStore.userAuthRequired, gateProductApi("chat"), async (req, res) => {
  const chatKey = ops.getChatKey();
  if (!chatKey) {
    return res.status(503).json({
      error: { message: "呆呆 AI 对话服务未就绪" },
    });
  }

  const body = req.body || {};
  const openid = (req.user && req.user.openid) || "";
  const payload = {
    model: DEFAULT_MODEL,
    messages: body.messages || [],
    max_tokens: body.max_tokens ?? 2000,
    temperature: body.temperature ?? 0.7,
    top_p: body.top_p ?? 0.9,
    stream: body.stream !== false,
  };

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return res.status(400).json({ error: { message: "messages 不能为空" } });
  }

  const started = Date.now();
  try {
    const upstream = await fetch(`${CHAT_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chatKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let message = `呆呆 AI 暂时繁忙（${upstream.status}）`;
      try {
        const parsed = JSON.parse(errText);
        message = parsed?.error?.message || message;
      } catch {
        if (errText) message = errText.slice(0, 300);
      }
      stats.chatFail += 1;
      if (openid) usageStore.recordChat(openid, false).catch(() => {});
      const publicMsg = sanitizePublicError(message, `呆呆 AI 暂时繁忙（${upstream.status}）`);
      logApiError(
        {
          source: "chat",
          message,
          status: upstream.status,
          path: "/api/chat",
          detail: `base=${CHAT_BASE_URL} model=${payload.model || DEFAULT_MODEL}`,
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(upstream.status).json({ error: { message: publicMsg } });
    }

    stats.chat += 1;
    ops.bumpHourly("chat");
    ops.pushLatency("chat", Date.now() - started);
    if (openid) usageStore.recordChat(openid, true).catch(() => {});

    if (payload.stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } finally {
        res.end();
      }
      return;
    }

    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error("chat proxy error:", err);
    stats.chatFail += 1;
    if (openid) usageStore.recordChat(openid, false).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    logApiError(
      {
        source: "chat",
        message,
        status: 502,
        path: "/api/chat",
        detail: `base=${CHAT_BASE_URL}`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(502).json({
      error: { message: sanitizePublicError(message, "代理请求失败") },
    });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUpstreamImageGeneration(imageKey, bodyObj) {
  const useProxyAsync = process.env.DAIDAI_IMAGE_PROXY_ASYNC === "1";
  const headers = {
    Authorization: `Bearer ${imageKey}`,
    "Content-Type": "application/json",
  };
  if (useProxyAsync) headers["X-Proxy-Mode"] = "async";

  let upstream = await outboundFetch(`${IMAGE_BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyObj),
  });

  // 中转异步未配置时回退同步，避免整条链路直接挂死
  if (useProxyAsync && upstream.status === 503) {
    const peek = await upstream.text();
    if (/async_not_configured|异步模式未启用/i.test(peek)) {
      console.warn("[image] proxy async not configured, fallback to sync");
      const syncHeaders = {
        Authorization: `Bearer ${imageKey}`,
        "Content-Type": "application/json",
      };
      upstream = await outboundFetch(`${IMAGE_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: syncHeaders,
        body: JSON.stringify(bodyObj),
      });
      return { upstream, raw: await upstream.text(), mode: "sync-fallback" };
    }
    return { upstream, raw: peek, mode: "async" };
  }

  if (useProxyAsync && upstream.status === 202) {
    const meta = await upstream.json().catch(() => ({}));
    const pollPath =
      meta.poll_url || (meta.id ? `/v1/proxy/tasks/${meta.id}` : "");
    if (!pollPath) {
      const err = new Error("中转异步已受理但未返回 poll_url");
      err.status = 502;
      throw err;
    }
    console.log(`[image] proxy async accepted task=${meta.id || "?"} poll=${pollPath}`);
    for (let i = 0; i < 120; i++) {
      await sleep(2000);
      upstream = await outboundFetch(`${IMAGE_BASE_URL}${pollPath}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${imageKey}` },
      });
      if (upstream.status !== 202) {
        return {
          upstream,
          raw: await upstream.text(),
          mode: "async",
          taskId: meta.id || "",
        };
      }
    }
    const err = new Error(
      "中转异步生图轮询超时（约 4 分钟）。请检查 Cloudflare Queue/Paid 或上游是否卡住"
    );
    err.status = 504;
    throw err;
  }

  return {
    upstream,
    raw: await upstream.text(),
    mode: useProxyAsync ? "async-sync-response" : "sync",
  };
}

async function generateImageOnce({ imageKey, prompt, size, origin, openid, jobId }) {
  const model = IMAGE_MODEL;
  const started = Date.now();
  const basePayload = {
    model,
    prompt,
    size,
    n: 1,
    quality: "medium",
    output_format: "jpeg",
  };
  let { upstream, raw, mode } = await fetchUpstreamImageGeneration(imageKey, basePayload);

  if (
    !upstream.ok &&
    /unknown|unsupported|invalid|quality|output_format/i.test(raw || "")
  ) {
    ({ upstream, raw, mode } = await fetchUpstreamImageGeneration(imageKey, {
      model,
      prompt,
      size,
      n: 1,
    }));
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!upstream.ok) {
    const message =
      data?.error?.message ||
      (raw ? raw.slice(0, 300) : `上游生图错误 ${upstream.status}`);
    const err = new Error(message);
    err.status = upstream.status;
    throw err;
  }
  const item = data?.data?.[0] || {};
  if (!item.b64_json && !item.url) {
    const err = new Error("上游未返回图片数据");
    err.status = 502;
    throw err;
  }
  const saved = await imageOut.saveGeneratedImage(item, {
    openid: openid || "",
    jobId: jobId || "",
    kind: "generate",
    prompt: String(prompt || "").slice(0, 500),
    size: size || "",
  });
  const imageUrl = origin
    ? `${origin}/api/image/file/${saved.id}`
    : `/api/image/file/${saved.id}`;
  return {
    image: imageUrl,
    imageId: saved.id,
    bytes: saved.bytes,
    ms: Date.now() - started,
    revised_prompt: item.revised_prompt || "",
    model,
    proxyMode: mode,
    provider: "openai",
  };
}

app.post("/api/image", authStore.userAuthRequired, gateProductApi("image"), async (req, res) => {
  const openid = (req.user && req.user.openid) || "";
  const imageKey = ops.getImageKey();
  if (!imageKey) {
    const hint = imageConfigHint();
    logApiError(
      {
        source: "image",
        message: "呆呆 Image 密钥未配置",
        status: 503,
        path: "/api/image",
        detail: `base=${hint.base} model=${hint.model}`,
        ip: ops.clientIp(req),
      },
      res
    );
    stats.imageFail += 1;
    return res.status(503).json({
      error: errorPayload("呆呆 Image 服务未就绪，请配置 DAIDAI_IMAGE_KEY", res, {
        hint: "env:DAIDAI_IMAGE_KEY",
      }),
    });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    logApiError(
      {
        source: "image",
        message: "prompt 为空",
        status: 400,
        path: "/api/image",
        ip: ops.clientIp(req),
      },
      res
    );
    return res.status(400).json({ error: errorPayload("prompt 不能为空", res) });
  }

  let quotaPreview;
  try {
    quotaPreview = await usageStore.assertImageQuota(openid);
  } catch (err) {
    if (err.code === "QUOTA") {
      return res.status(429).json({
        ok: false,
        error: {
          message: err.message,
          code: "QUOTA",
          used: err.used,
          limit: err.limit,
        },
      });
    }
    return res.status(401).json({ ok: false, error: { message: err.message || "请先登录" } });
  }

  const size = body.size || "1152x1536";
  const origin = imageOut.publicOrigin(req, ops.loadSettings());
  const wantSync = body.sync === true || body.sync === 1 || body.sync === "1";

  async function finishImageOk(result) {
    let quota = quotaPreview;
    try {
      quota = await usageStore.tryConsumeImageQuota(openid);
    } catch (_) {
      /* 出图已成功，额度边界竞态时仍记成功 */
    }
    stats.image += 1;
    ops.bumpHourly("image");
    ops.pushLatency("image", result.ms);
    usageStore.recordImage(openid, "generate", true).catch(() => {});
    return quota;
  }

  if (!wantSync) {
    let job;
    try {
      job = await imageJobs.createJob({ prompt: prompt.slice(0, 200), size, openid });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: { message: (err && err.message) || "数据库未就绪" },
      });
    }
    res.json({
      ok: true,
      pending: true,
      status: "pending",
      jobId: job.id,
      id: job.id,
      product: "呆呆 Image",
      message: "生图任务已提交，请轮询 /api/image/job/:id",
      quota: quotaPreview,
      provider: "openai",
    });
    setImmediate(async () => {
      try {
        const result = await generateImageOnce({
          imageKey,
          prompt,
          size,
          origin,
          openid,
          jobId: job.id,
        });
        await finishImageOk(result);
        await imageJobs.updateJob(job.id, {
          status: "done",
          image: result.image,
          imageId: result.imageId,
          ms: result.ms,
          error: "",
        });
        console.log(
          `[image-ok] job=${job.id} id=${result.imageId} bytes=${result.bytes} ms=${result.ms} provider=${result.provider}`
        );
      } catch (err) {
        stats.imageFail += 1;
        usageStore.recordImage(openid, "generate", false).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        const status = err && err.status ? err.status : 502;
        logApiError({
          source: "image",
          message,
          status,
          path: "/api/image",
          detail: `job=${job.id} openid=${openid} model=${IMAGE_MODEL} base=${IMAGE_BASE_URL} prompt=${prompt.slice(0, 80)}`,
          ip: ops.clientIp(req),
        });
        await imageJobs.updateJob(job.id, {
          status: "error",
          error: sanitizePublicError(
            message,
            status === 504
              ? "生图超时：上游等待过久。若账单已扣费，多为网关超时，请检查代理或稍后重试"
              : "生图失败"
          ),
          ms: Date.now() - job.createdAt,
        });
        console.error(`[image-fail] job=${job.id}`, message);
      }
    });
    return;
  }

  try {
    const result = await generateImageOnce({ imageKey, prompt, size, origin, openid });
    const quota = await finishImageOk(result);
    res.json({
      ok: true,
      product: "呆呆 Image",
      size,
      image: result.image,
      imageId: result.imageId,
      revised_prompt: result.revised_prompt || "",
      quota,
      provider: result.provider,
    });
  } catch (err) {
    console.error("image proxy error:", err);
    stats.imageFail += 1;
    usageStore.recordImage(openid, "generate", false).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    const status = err && err.status ? err.status : 502;
    logApiError(
      {
        source: "image",
        message,
        status,
        path: "/api/image",
        detail: `openid=${openid} model=${IMAGE_MODEL} base=${IMAGE_BASE_URL}`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: errorPayload(
        sanitizePublicError(
          message,
          status === 504
            ? "生图超时：上游或网关等待过久，上游可能已扣费"
            : "生图失败，请检查上游与密钥"
        ),
        res,
        { base: IMAGE_BASE_URL, model: IMAGE_MODEL }
      ),
    });
  }
});

app.get("/api/image/job/:id", async (req, res) => {
  try {
    const job = await imageJobs.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: { message: "任务不存在或已过期" } });
    }
    res.json({ ok: true, job: imageJobs.publicJob(job) });
  } catch (err) {
    res.status(503).json({ ok: false, error: { message: (err && err.message) || "数据库未就绪" } });
  }
});

/**
 * 改图核心：原图 + 指令 → GPT images/edits → 压缩打水印存盘
 */
async function runImageEditOnce({ imageKey, prompt, imageB64, mime, size, origin, openid, jobId }) {
  const model = IMAGE_MODEL;
  const started = Date.now();
  const type = mime || "image/png";
  const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : "png";
  const buf = Buffer.from(imageB64, "base64");
  if (!buf.length) {
    const err = new Error("图片数据无效");
    err.status = 400;
    throw err;
  }
  if (buf.length > 18 * 1024 * 1024) {
    const err = new Error("图片过大，请压缩后再试");
    err.status = 400;
    throw err;
  }

  async function callEdit(fieldName) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size || "auto");
    form.append("n", "1");
    form.append(fieldName, new Blob([buf], { type }), `upload.${ext}`);
    const upstream = await outboundFetch(`${IMAGE_BASE_URL}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${imageKey}` },
      body: form,
    });
    const raw = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    return { upstream, raw, data };
  }

  let { upstream, raw, data } = await callEdit("image[]");
  if (!upstream.ok) {
    const retry = await callEdit("image");
    if (retry.upstream.ok) {
      upstream = retry.upstream;
      raw = retry.raw;
      data = retry.data;
    } else {
      const message =
        retry.data?.error?.message ||
        data?.error?.message ||
        (retry.raw || raw || "").slice(0, 300) ||
        `上游改图错误 ${retry.upstream.status}`;
      const err = new Error(message);
      err.status = retry.upstream.status || 502;
      throw err;
    }
  }
  const item = data?.data?.[0] || {};
  if (!item.b64_json && !item.url) {
    const err = new Error("上游未返回图片数据");
    err.status = 502;
    throw err;
  }
  const saved = await imageOut.saveGeneratedImage(item, {
    openid: openid || "",
    jobId: jobId || "",
    kind: "edit",
    prompt: String(prompt || "").slice(0, 500),
    size: size || "",
  });
  const imageUrl = origin
    ? `${origin}/api/image/file/${saved.id}`
    : `/api/image/file/${saved.id}`;
  return {
    image: imageUrl,
    imageId: saved.id,
    bytes: saved.bytes,
    ms: Date.now() - started,
    revised_prompt: item.revised_prompt || "",
    size: size || "auto",
    model,
    provider: "openai",
  };
}

/**
 * AI 改图：默认异步 job（避免云托管网关 504），与生图一致可轮询 /api/image/job/:id
 * body: { prompt, image_b64, mime?, size?, sync? }
 */
app.post("/api/image/edit", authStore.userAuthRequired, gateProductApi("imageEdit"), async (req, res) => {
  const openid = (req.user && req.user.openid) || "";
  const imageKey = ops.getImageKey();
  if (!imageKey) {
    const hint = imageConfigHint();
    logApiError(
      {
        source: "imageEdit",
        message: "呆呆 Image 密钥未配置",
        status: 503,
        path: "/api/image/edit",
        detail: `base=${hint.base} model=${hint.model}`,
        ip: ops.clientIp(req),
      },
      res
    );
    stats.imageEditFail += 1;
    return res.status(503).json({
      error: {
        message: "呆呆 Image 服务未就绪，请配置 DAIDAI_IMAGE_KEY",
      },
    });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || "").trim();
  let imageB64 = String(body.image_b64 || body.image || "").trim();
  if (!prompt) {
    return res.status(400).json({ error: { message: "prompt 不能为空" } });
  }
  if (!imageB64) {
    return res.status(400).json({ error: { message: "请上传要修改的图片" } });
  }

  let mime = body.mime || "image/png";
  const dataUrl = imageB64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataUrl) {
    mime = dataUrl[1];
    imageB64 = dataUrl[2];
  }
  imageB64 = imageB64.replace(/\s+/g, "");

  let quotaPreview;
  try {
    quotaPreview = await usageStore.assertImageQuota(openid);
  } catch (err) {
    if (err.code === "QUOTA") {
      return res.status(429).json({
        ok: false,
        error: {
          message: err.message,
          code: "QUOTA",
          used: err.used,
          limit: err.limit,
        },
      });
    }
    return res.status(401).json({ ok: false, error: { message: err.message || "请先登录" } });
  }

  const size = body.size || "1152x1536";
  const origin = imageOut.publicOrigin(req, ops.loadSettings());
  const wantSync = body.sync === true || body.sync === 1 || body.sync === "1";

  async function finishEditOk(result) {
    let quota = quotaPreview;
    try {
      quota = await usageStore.tryConsumeImageQuota(openid);
    } catch (_) {
      /* ignore */
    }
    stats.imageEdit += 1;
    ops.bumpHourly("imageEdit");
    ops.pushLatency("imageEdit", result.ms);
    usageStore.recordImage(openid, "edit", true).catch(() => {});
    return quota;
  }

  if (!wantSync) {
    let job;
    try {
      job = await imageJobs.createJob({
        prompt: prompt.slice(0, 200),
        size,
        kind: "edit",
        openid,
      });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: { message: (err && err.message) || "数据库未就绪" },
      });
    }
    res.json({
      ok: true,
      pending: true,
      status: "pending",
      jobId: job.id,
      id: job.id,
      product: "呆呆 Image",
      message: "改图任务已提交，请轮询 /api/image/job/:id",
      quota: quotaPreview,
      provider: "openai",
    });
    setImmediate(async () => {
      try {
        const result = await runImageEditOnce({
          imageKey,
          prompt,
          imageB64,
          mime,
          size,
          origin,
          openid,
          jobId: job.id,
        });
        await finishEditOk(result);
        await imageJobs.updateJob(job.id, {
          status: "done",
          image: result.image,
          imageId: result.imageId,
          ms: result.ms,
          error: "",
        });
        console.log(`[image-edit-ok] job=${job.id} id=${result.imageId} ms=${result.ms} provider=${result.provider}`);
      } catch (err) {
        stats.imageEditFail += 1;
        usageStore.recordImage(openid, "edit", false).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        const status = err && err.status ? err.status : 502;
        logApiError({
          source: "imageEdit",
          message,
          status,
          path: "/api/image/edit",
          detail: `job=${job.id} openid=${openid} model=${IMAGE_MODEL} prompt=${prompt.slice(0, 80)}`,
          ip: ops.clientIp(req),
        });
        await imageJobs.updateJob(job.id, {
          status: "error",
          error: sanitizePublicError(message, "改图失败"),
          ms: Date.now() - job.createdAt,
        });
        console.error(`[image-edit-fail] job=${job.id}`, message);
      }
    });
    return;
  }

  try {
    const result = await runImageEditOnce({
      imageKey,
      prompt,
      imageB64,
      mime,
      size,
      origin,
      openid,
    });
    const quota = await finishEditOk(result);
    res.json({
      ok: true,
      product: "呆呆 Image",
      size: result.size,
      image: result.image,
      imageId: result.imageId,
      revised_prompt: result.revised_prompt || "",
      quota,
      provider: result.provider,
    });
  } catch (err) {
    console.error("image edit proxy error:", err);
    stats.imageEditFail += 1;
    usageStore.recordImage(openid, "edit", false).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    const status = err && err.status ? err.status : 502;
    logApiError(
      {
        source: "imageEdit",
        message,
        status,
        path: "/api/image/edit",
        detail: `openid=${openid} model=${IMAGE_MODEL}`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: { message: sanitizePublicError(message, "改图失败") },
    });
  }
});

app.get("/api/image/file/:id", async (req, res) => {
  const safe = String(req.params.id || "").replace(/[^a-zA-Z0-9_-]/g, "") || "daidai";
  const hit = await imageOut.resolveImageBuffer(safe);
  if (!hit || !hit.buffer || !hit.buffer.length) {
    return res.status(404).json({ error: { message: "图片不存在或已过期" } });
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.query.download === "1" || req.query.download === "true") {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="daidai-ai-${safe}.jpg"; filename*=UTF-8''daidai-ai-${safe}.jpg`
    );
  }
  res.type(hit.mime || "image/jpeg");
  res.send(hit.buffer);
});

/**
 * 豆包识图：上传图片 + 问题，返回文字描述/回答
 * body: { prompt?, image_b64, mime? } 或 { prompt?, image_url }
 */
app.post("/api/vision", authStore.userAuthRequired, gateProductApi("chat"), async (req, res) => {
  const openid = (req.user && req.user.openid) || "";
  const body = req.body || {};
  const prompt = String(body.prompt || body.question || "请详细描述这张图片的内容。").trim();
  let imageB64 = String(body.image_b64 || body.image || "").trim();
  let mime = body.mime || "image/jpeg";
  const imageUrl = String(body.image_url || body.url || "").trim();
  const dataUrl = imageB64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataUrl) {
    mime = dataUrl[1];
    imageB64 = dataUrl[2];
  }
  imageB64 = imageB64.replace(/\s+/g, "");
  if (!imageB64 && !imageUrl) {
    return res.status(400).json({ ok: false, error: { message: "请上传要识别的图片" } });
  }

  const arkKey = ops.getDoubaoKey() || doubaoImage.getApiKey();
  if (!arkKey) {
    return res.status(503).json({
      ok: false,
      error: {
        message: "识图未配置：请在环境变量填写 DOUBAO_ARK_API_KEY（或 ARK_API_KEY），豆包仅用于识图",
      },
    });
  }

  const started = Date.now();
  try {
    const result = await doubaoImage.visionChat({
      apiKey: arkKey,
      prompt,
      imageB64: imageB64 || "",
      mime,
      imageUrl: imageUrl || "",
    });
    if (openid) usageStore.recordChat(openid, true).catch(() => {});
    stats.chat += 1;
    ops.bumpHourly("chat");
    ops.pushLatency("chat", Date.now() - started);
    res.json({
      ok: true,
      product: "呆呆 AI",
      provider: "doubao",
      model: result.model,
      content: result.content,
      choices: [{ message: { role: "assistant", content: result.content } }],
    });
  } catch (err) {
    if (openid) usageStore.recordChat(openid, false).catch(() => {});
    stats.chatFail += 1;
    const message = err instanceof Error ? err.message : String(err);
    const status = err && err.status ? err.status : 502;
    logApiError(
      {
        source: "vision",
        message,
        status,
        path: "/api/vision",
        detail: `openid=${openid}`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(status >= 400 && status < 600 ? status : 502).json({
      ok: false,
      error: { message: sanitizePublicError(message, "识图失败") },
    });
  }
});

const adminDir = path.join(__dirname, "admin");
app.use("/admin", express.static(adminDir));
app.get("/admin", (_req, res) => {
  res.redirect(301, "/admin/");
});

app.use(maintenanceSiteGate);

/** 网站端：与小程序同款淡绿主页 + 豆包风聊天（不再用旧 web-ui） */
const siteDir = path.join(__dirname, "site");
app.use(express.static(siteDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) return next();
  res.sendFile(path.join(siteDir, "index.html"), (err) => {
    if (err) {
      res
        .status(503)
        .type("html")
        .send("<h1>呆呆网络</h1><p>站点文件缺失，请确认已部署 <code>site/</code> 目录。</p>");
    }
  });
});

app.listen(PORT, "0.0.0.0", async () => {
  if (db.isConfigured()) {
    const ok = await db.init();
    if (ok) {
      await ops.hydrateFromDb();
      await ops.hydrateSecretsFromDb();
    }
  } else {
    console.warn(
      "[db] MySQL 未配置：请按官方要求在服务设置填写 MYSQL_ADDRESS、MYSQL_USERNAME、MYSQL_PASSWORD"
    );
  }
  console.log(
    `呆呆网络 listening on ${PORT}, chatConfigured=${Boolean(ops.getChatKey())}, imageBase=${IMAGE_BASE_URL}, dbReady=${db.isReady()}, sharp=${imageOut.hasSharp()}, cos=${cosStore.isConfigured()}, storage=mysql, site=/, admin=/admin/`
  );
  imageOut.cleanupOldImages().catch(() => {});
  setInterval(() => {
    imageOut.cleanupOldImages().catch(() => {});
  }, 6 * 3600 * 1000).unref?.();

  // 轻量保活：定时 ping 数据库，让 Serverless MySQL 保持热连接，
  // 减少冷启动/唤醒导致的首个请求超时（“掉线”）。
  setInterval(() => {
    if (db.isReady()) {
      db.query("SELECT 1").catch(() => {});
    }
  }, 60 * 1000).unref?.();
});
