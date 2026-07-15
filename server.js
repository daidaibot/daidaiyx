const path = require("path");
const fs = require("fs");
const express = require("express");
const ops = require("./lib/ops");
const imageOut = require("./lib/imageOut");

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

/** 生图上游（内部）；对外一律称「呆呆 Image」；默认走呆呆中转，避免国内直连失败 */
const IMAGE_BASE_URL = (
  process.env.DAIDAI_IMAGE_BASE_URL ||
  process.env.OPENAI_IMAGE_BASE_URL ||
  process.env.OPENAI_API_BASE ||
  "https://openai.dai520.cn"
).replace(/\/$/, "");
const IMAGE_MODEL =
  process.env.DAIDAI_IMAGE_MODEL || process.env.IMAGE_MODEL || "gpt-image-2";

app.use(express.json({ limit: "20mb" }));
app.use(ops.requestLogger);
app.use(maintenanceApiGate);

const WECHAT_APPID = process.env.WECHAT_APPID || process.env.WX_APPID || "";
const WECHAT_SECRET = process.env.WECHAT_SECRET || process.env.WX_SECRET || "";
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
/** 网页端仅本人使用：可用独立密码，默认与后台密码相同 */
const WEB_PASSWORD =
  process.env.WEB_PASSWORD || process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKENS = new Set();

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
  return token;
}

function adminAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !ADMIN_TOKENS.has(token)) {
    return res.status(401).json({ error: { message: "未登录或已过期" } });
  }
  next();
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
  if (req.path === "/api/public/status" || req.path === "/health" || req.path === "/api/report-error") {
    return next();
  }
  if (req.path.startsWith("/api/image/file/")) return next();
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

app.post("/api/admin/logout", adminAuth, (req, res) => {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  ADMIN_TOKENS.delete(token);
  res.json({ ok: true });
});

app.get("/api/admin/overview", adminAuth, (_req, res) => {
  const settings = ops.loadSettings();
  const system = ops.getSystemInfo();
  const sec = ops.secretsStatus();
  res.json({
    ok: true,
    brand: "呆呆网络",
    product: "呆呆 AI",
    uptimeSec: Math.floor((Date.now() - stats.startedAt) / 1000),
    stats: {
      chat: stats.chat,
      image: stats.image,
      imageEdit: stats.imageEdit,
      login: stats.login,
      chatFail: stats.chatFail,
      imageFail: stats.imageFail,
      imageEditFail: stats.imageEditFail,
    },
    hourly: ops.getHourlySeries(24),
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
    chatConfigured: sec.chatConfigured,
    imageConfigured: sec.imageConfigured,
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
    webPasswordConfigured: Boolean(WEB_PASSWORD),
    adminConfigured: Boolean(ADMIN_PASSWORD),
    allowDevLogin: ALLOW_DEV_LOGIN,
    upstream: {
      chatBase: CHAT_BASE_URL,
      imageBase: IMAGE_BASE_URL,
      chatModel: DEFAULT_MODEL,
      imageModel: IMAGE_MODEL,
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

app.get("/api/admin/logs", adminAuth, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 80);
  res.json({ ok: true, logs: ops.getLogs(limit) });
});

app.get("/api/admin/errors", adminAuth, (req, res) => {
  const limit = Math.min(150, Number(req.query.limit) || 60);
  const errors = ops.getErrors(limit);
  res.json({
    ok: true,
    errors,
    meta: {
      count: errors.length,
      dataDir: ops.DATA_DIR,
      tip:
        errors.length === 0
          ? "若刚失败却仍为空：云托管请固定 1 个实例，并挂载持久盘到 /app/data"
          : "",
    },
  });
});

app.post("/api/admin/logs/clear", adminAuth, (_req, res) => {
  ops.clearLogs();
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
      小程序对接域名: settings.publicApiBase || "未填写",
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
      { method: "POST", path: "/api/chat", desc: "对话代理" },
      { method: "POST", path: "/api/image", desc: "生图" },
      { method: "POST", path: "/api/image/edit", desc: "改图" },
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
      return res.json({
        ok: Boolean(WECHAT_APPID && WECHAT_SECRET),
        kind,
        ms: Date.now() - started,
        preview: WECHAT_APPID ? `小程序已绑定 ${ops.maskSecret(WECHAT_APPID)}` : "未配置",
        error: WECHAT_APPID && WECHAT_SECRET ? "" : "缺少小程序登录配置",
      });
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
      // 用 /v1/models 真连中转（不扣生图费），验证密钥+网络
      const upstream = await fetch(`${IMAGE_BASE_URL}/v1/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${imageKey}` },
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
          ? `中转可达 · ${IMAGE_BASE_URL} · 模型列表 ${modelCount} 项 · 目标模型 ${IMAGE_MODEL}`
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
    apiBase: settings.publicApiBase || "",
    chatReady: chatReady && !settings.blockChat && !settings.maintenance,
    imageReady: imageReady && !settings.blockImage && !settings.maintenance,
  });
});

function hashCode(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}

/**
 * 小程序登录：wx.login code → jscode2session
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
  const avatarUrl = String(body.avatarUrl || "").trim();

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
      stats.login += 1;
      ops.bumpHourly("login");
      return res.json({
        ok: true,
        openid,
        token: `dev_${openid}`,
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
    const upstream = await fetch(url);
    const data = await upstream.json();
    if (!data.openid) {
      console.error("jscode2session failed:", data);
      ops.pushError({ source: "auth", message: "jscode2session 无 openid" });
      return res.status(401).json({
        ok: false,
        error: { message: "微信授权失败，请返回重试" },
      });
    }
    stats.login += 1;
    ops.bumpHourly("login");
    return res.json({
      ok: true,
      openid: data.openid,
      unionid: data.unionid || "",
      token: `wx_${data.openid}_${hashCode(data.session_key || code)}`,
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

/**
 * 网页端仅本人使用：密码通行（默认与 ADMIN_PASSWORD 相同）
 * 普通用户请走小程序微信登录
 */
app.post("/api/auth/web-login", (req, res) => {
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
  const openid = "web_owner";
  stats.login += 1;
  ops.bumpHourly("login");
  return res.json({
    ok: true,
    openid,
    token: `web_${openid}_${hashCode(password + Date.now())}`,
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
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "daidaiyx",
    brand: "呆呆网络",
    chatConfigured: Boolean(ops.getChatKey()),
    imageConfigured: Boolean(ops.getImageKey()),
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
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

app.post("/api/chat", gateProductApi("chat"), async (req, res) => {
  const chatKey = ops.getChatKey();
  if (!chatKey) {
    return res.status(503).json({
      error: { message: "呆呆 AI 对话服务未就绪" },
    });
  }

  const body = req.body || {};
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

app.post("/api/image", gateProductApi("image"), async (req, res) => {
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

  const size = body.size || "1024x1024";
  const model = IMAGE_MODEL;
  const payload = {
    model,
    prompt,
    size,
    n: 1,
    // 尽量让上游返回更小体积，避免小程序解析超大 JSON 失败（OpenAI 已扣费但前端当失败）
    quality: "medium",
    output_format: "jpeg",
  };

  const started = Date.now();
  try {
    let upstream = await fetch(`${IMAGE_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${imageKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    let raw = await upstream.text();
    // 若中转/模型不接受 quality、output_format，回退最小参数
    if (!upstream.ok && /unknown|unsupported|invalid|quality|output_format/i.test(raw)) {
      upstream = await fetch(`${IMAGE_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${imageKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, prompt, size, n: 1 }),
      });
      raw = await upstream.text();
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
      stats.imageFail += 1;
      logApiError(
        {
          source: "image",
          message,
          status: upstream.status,
          path: "/api/image",
          detail: `model=${model} base=${IMAGE_BASE_URL} size=${size} prompt=${prompt.slice(0, 80)}`,
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(upstream.status).json({
        error: errorPayload(
          sanitizePublicError(message, `生图失败（${upstream.status}）`),
          res,
          { base: IMAGE_BASE_URL, model }
        ),
      });
    }

    const item = data?.data?.[0] || {};
    if (!item.b64_json && !item.url) {
      stats.imageFail += 1;
      logApiError(
        {
          source: "image",
          message: "上游未返回图片数据",
          status: 502,
          path: "/api/image",
          detail: `model=${model} base=${IMAGE_BASE_URL} raw=${String(raw).slice(0, 200)}`,
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(502).json({
        error: errorPayload("上游未返回图片数据", res, { base: IMAGE_BASE_URL, model }),
      });
    }

    const saved = await imageOut.saveGeneratedImage(item);
    const origin = imageOut.publicOrigin(req, ops.loadSettings());
    const imageUrl = origin
      ? `${origin}/api/image/file/${saved.id}`
      : `/api/image/file/${saved.id}`;

    stats.image += 1;
    ops.bumpHourly("image");
    ops.pushLatency("image", Date.now() - started);
    console.log(
      `[image-ok] id=${saved.id} bytes=${saved.bytes} sharp=${imageOut.hasSharp()} ms=${Date.now() - started}`
    );
    res.json({
      ok: true,
      product: "呆呆 Image",
      size,
      image: imageUrl,
      imageId: saved.id,
      revised_prompt: item.revised_prompt || "",
    });
  } catch (err) {
    console.error("image proxy error:", err);
    stats.imageFail += 1;
    const message = err instanceof Error ? err.message : String(err);
    logApiError(
      {
        source: "image",
        message,
        status: 502,
        path: "/api/image",
        detail: `model=${IMAGE_MODEL} base=${IMAGE_BASE_URL} · 常见原因：中转不可达或密钥无效`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(502).json({
      error: errorPayload(
        sanitizePublicError(message, "生图代理失败，请检查中转与密钥"),
        res,
        { base: IMAGE_BASE_URL, model: IMAGE_MODEL }
      ),
    });
  }
});

/**
 * AI 改图：原图 + 文字指令 → gpt-image-2 /v1/images/edits
 * body: { prompt, image_b64, mime?, size?, model? }
 */
app.post("/api/image/edit", gateProductApi("imageEdit"), async (req, res) => {
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
    logApiError(
      {
        source: "imageEdit",
        message: "prompt 为空",
        status: 400,
        path: "/api/image/edit",
        ip: ops.clientIp(req),
      },
      res
    );
    return res.status(400).json({ error: { message: "prompt 不能为空" } });
  }
  if (!imageB64) {
    logApiError(
      {
        source: "imageEdit",
        message: "未上传原图",
        status: 400,
        path: "/api/image/edit",
        ip: ops.clientIp(req),
      },
      res
    );
    return res.status(400).json({ error: { message: "请上传要修改的图片" } });
  }

  let mime = body.mime || "image/png";
  const dataUrl = imageB64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrl) {
    mime = dataUrl[1];
    imageB64 = dataUrl[2];
  }

  const size = body.size || "1024x1024";
  const model = IMAGE_MODEL;
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";

  const started = Date.now();
  try {
    const buf = Buffer.from(imageB64, "base64");
    if (!buf.length) {
      logApiError(
        {
          source: "imageEdit",
          message: "图片数据无效",
          status: 400,
          path: "/api/image/edit",
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(400).json({ error: { message: "图片数据无效" } });
    }
    if (buf.length > 18 * 1024 * 1024) {
      logApiError(
        {
          source: "imageEdit",
          message: "图片过大",
          status: 400,
          path: "/api/image/edit",
          detail: `bytes=${buf.length}`,
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(400).json({ error: { message: "图片过大，请压缩后再试" } });
    }

    async function callEdit(fieldName) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("n", "1");
      form.append(fieldName, new Blob([buf], { type: mime }), `upload.${ext}`);
      const upstream = await fetch(`${IMAGE_BASE_URL}/v1/images/edits`, {
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
        stats.imageEditFail += 1;
        logApiError(
          {
            source: "imageEdit",
            message,
            status: retry.upstream.status,
            path: "/api/image/edit",
            detail: `model=${model} base=${IMAGE_BASE_URL} prompt=${prompt.slice(0, 80)}`,
            ip: ops.clientIp(req),
          },
          res
        );
        return res.status(retry.upstream.status).json({
          error: { message: sanitizePublicError(message, `改图失败（${retry.upstream.status}）`) },
        });
      }
    }

    const item = data?.data?.[0] || {};
    if (!item.b64_json && !item.url) {
      stats.imageEditFail += 1;
      logApiError(
        {
          source: "imageEdit",
          message: "上游未返回图片数据",
          status: 502,
          path: "/api/image/edit",
          detail: `model=${model} base=${IMAGE_BASE_URL} raw=${String(raw).slice(0, 200)}`,
          ip: ops.clientIp(req),
        },
        res
      );
      return res.status(502).json({ error: { message: "上游未返回图片数据" } });
    }

    const saved = await imageOut.saveGeneratedImage(item);
    const origin = imageOut.publicOrigin(req, ops.loadSettings());
    const imageUrl = origin
      ? `${origin}/api/image/file/${saved.id}`
      : `/api/image/file/${saved.id}`;

    stats.imageEdit += 1;
    ops.bumpHourly("imageEdit");
    ops.pushLatency("imageEdit", Date.now() - started);
    res.json({
      ok: true,
      product: "呆呆 Image",
      size,
      image: imageUrl,
      imageId: saved.id,
      revised_prompt: item.revised_prompt || "",
    });
  } catch (err) {
    console.error("image edit proxy error:", err);
    stats.imageEditFail += 1;
    const message = err instanceof Error ? err.message : String(err);
    logApiError(
      {
        source: "imageEdit",
        message,
        status: 502,
        path: "/api/image/edit",
        detail: `model=${IMAGE_MODEL} base=${IMAGE_BASE_URL}`,
        ip: ops.clientIp(req),
      },
      res
    );
    res.status(502).json({
      error: {
        message: sanitizePublicError(message, "改图代理失败，请检查中转与密钥"),
      },
    });
  }
});

app.get("/api/image/file/:id", (req, res) => {
  const file = imageOut.resolveImageFile(req.params.id);
  if (!file) {
    return res.status(404).json({ error: { message: "图片不存在或已过期" } });
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type("image/jpeg");
  fs.createReadStream(file).pipe(res);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `呆呆网络 listening on ${PORT}, chatConfigured=${Boolean(ops.getChatKey())}, imageBase=${IMAGE_BASE_URL}, sharp=${imageOut.hasSharp()}, site=/, admin=/admin/`
  );
  imageOut.cleanupOldImages();
  setInterval(() => imageOut.cleanupOldImages(), 6 * 3600 * 1000).unref?.();
});
