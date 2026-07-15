const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 80;

const OPENAI_BASE_URL = (
  process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
).replace(/\/$/, "");
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.CHAT_MODEL || "deepseek-chat";

/** 生图走 OpenAI Image（gpt-image-2），与聊天 Key 可分开 */
const IMAGE_BASE_URL = (
  process.env.OPENAI_IMAGE_BASE_URL ||
  process.env.OPENAI_API_BASE ||
  "https://api.openai.com"
).replace(/\/$/, "");
const IMAGE_API_KEY =
  process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";

app.use(express.json({ limit: "20mb" }));

const WECHAT_APPID = process.env.WECHAT_APPID || process.env.WX_APPID || "";
const WECHAT_SECRET = process.env.WECHAT_SECRET || process.env.WX_SECRET || "";
/** 网站扫码 / 微信内网页授权（开放平台网站应用，参考 wechat OAuth2 流程） */
const WECHAT_OPEN_APPID =
  process.env.WECHAT_OPEN_APPID || process.env.WECHAT_WEB_APPID || "";
const WECHAT_OPEN_SECRET =
  process.env.WECHAT_OPEN_SECRET || process.env.WECHAT_WEB_SECRET || "";
const WECHAT_OAUTH_REDIRECT = (
  process.env.WECHAT_OAUTH_REDIRECT || ""
).replace(/\/$/, "");
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === "1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKENS = new Set();
const OAUTH_STATES = new Map();

const stats = {
  chat: 0,
  image: 0,
  imageEdit: 0,
  login: 0,
  startedAt: Date.now(),
};

function pruneOauthStates() {
  const now = Date.now();
  for (const [k, v] of OAUTH_STATES) {
    if (!v || v.expiresAt < now) OAUTH_STATES.delete(k);
  }
}

function publicBase(req) {
  if (WECHAT_OAUTH_REDIRECT) {
    try {
      const u = new URL(WECHAT_OAUTH_REDIRECT);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return host ? `${proto}://${host}` : "";
}

function safeReturnPath(raw) {
  const s = String(raw || "/chat.html").trim() || "/chat.html";
  if (!s.startsWith("/") || s.startsWith("//")) return "/chat.html";
  return s.slice(0, 200);
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
    },
    chatConfigured: Boolean(API_KEY),
    imageConfigured: Boolean(IMAGE_API_KEY),
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
    webWechatLoginConfigured: Boolean(WECHAT_OPEN_APPID && WECHAT_OPEN_SECRET),
    adminConfigured: Boolean(ADMIN_PASSWORD),
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
      return res.status(401).json({
        ok: false,
        error: { message: "微信授权失败，请返回重试" },
      });
    }
    stats.login += 1;
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
    return res.status(502).json({
      ok: false,
      error: { message: "登录服务繁忙，请稍后再试" },
    });
  }
});

/**
 * 网页微信登录（跳转微信）
 * 参考开放平台 OAuth2 / 常见开源实现（qrconnect + code 换 token）
 * 环境变量：WECHAT_OPEN_APPID + WECHAT_OPEN_SECRET
 * 可选：WECHAT_OAUTH_REDIRECT=https://域名/api/auth/wechat/callback
 */
app.get("/api/auth/wechat/start", (req, res) => {
  if (!WECHAT_OPEN_APPID || !WECHAT_OPEN_SECRET) {
    return res
      .status(503)
      .type("html")
      .send(
        "<!doctype html><meta charset=utf-8><title>未配置</title>" +
          "<p style='font-family:sans-serif;padding:40px'>未配置网站微信登录。<br/>请在云托管设置 <code>WECHAT_OPEN_APPID</code> 与 <code>WECHAT_OPEN_SECRET</code>（微信开放平台 · 网站应用）。</p>"
      );
  }

  pruneOauthStates();
  const returnPath = safeReturnPath(req.query.return);
  const state = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  OAUTH_STATES.set(state, {
    returnPath,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const base = publicBase(req);
  const redirectUri = encodeURIComponent(
    WECHAT_OAUTH_REDIRECT || `${base}/api/auth/wechat/callback`
  );
  const ua = String(req.headers["user-agent"] || "");
  const inWeChat = /MicroMessenger/i.test(ua);

  // 微信内走网页授权；浏览器/PC 走扫码登录
  const url = inWeChat
    ? `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(
        WECHAT_OPEN_APPID
      )}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_userinfo&state=${encodeURIComponent(
        state
      )}#wechat_redirect`
    : `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(
        WECHAT_OPEN_APPID
      )}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${encodeURIComponent(
        state
      )}#wechat_redirect`;

  res.redirect(302, url);
});

app.get("/api/auth/wechat/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  pruneOauthStates();
  const st = OAUTH_STATES.get(state);
  OAUTH_STATES.delete(state);

  const fail = (msg) => {
    const back = (st && st.returnPath) || "/chat.html";
    res.redirect(
      302,
      `${back}${back.includes("?") ? "&" : "?"}wx_error=${encodeURIComponent(msg)}`
    );
  };

  if (!code) return fail("用户取消了微信授权");
  if (!st) return fail("登录已过期，请重试");
  if (!WECHAT_OPEN_APPID || !WECHAT_OPEN_SECRET) return fail("未配置网站微信登录");

  try {
    const tokenUrl =
      "https://api.weixin.qq.com/sns/oauth2/access_token" +
      `?appid=${encodeURIComponent(WECHAT_OPEN_APPID)}` +
      `&secret=${encodeURIComponent(WECHAT_OPEN_SECRET)}` +
      `&code=${encodeURIComponent(code)}` +
      "&grant_type=authorization_code";
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token || !tokenData.openid) {
      console.error("oauth access_token failed:", tokenData);
      return fail("微信授权失败，请重试");
    }

    let nickName = "微信用户";
    let avatarUrl = "";
    try {
      const infoUrl =
        "https://api.weixin.qq.com/sns/userinfo" +
        `?access_token=${encodeURIComponent(tokenData.access_token)}` +
        `&openid=${encodeURIComponent(tokenData.openid)}` +
        "&lang=zh_CN";
      const infoRes = await fetch(infoUrl);
      const info = await infoRes.json();
      if (info && info.nickname) nickName = String(info.nickname);
      if (info && info.headimgurl) avatarUrl = String(info.headimgurl);
    } catch (e) {
      console.error("oauth userinfo error:", e);
    }

    stats.login += 1;
    const sessionToken = `web_${tokenData.openid}_${hashCode(
      tokenData.access_token || code
    )}`;
    const q = new URLSearchParams({
      wx_ok: "1",
      openid: tokenData.openid,
      token: sessionToken,
      nickName,
      avatarUrl,
    });
    const back = st.returnPath || "/chat.html";
    res.redirect(302, `${back}${back.includes("?") ? "&" : "?"}${q.toString()}`);
  } catch (err) {
    console.error("oauth callback error:", err);
    return fail("登录服务繁忙");
  }
});

app.get("/api/auth/wechat/status", (_req, res) => {
  res.json({
    ok: true,
    miniProgramLogin: Boolean(WECHAT_APPID && WECHAT_SECRET),
    webWechatLogin: Boolean(WECHAT_OPEN_APPID && WECHAT_OPEN_SECRET),
    allowDevLogin: ALLOW_DEV_LOGIN,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "daidaiyx",
    brand: "呆呆网络",
    chatConfigured: Boolean(API_KEY),
    imageConfigured: Boolean(IMAGE_API_KEY),
    wechatLoginConfigured: Boolean(WECHAT_APPID && WECHAT_SECRET),
  });
});

app.get("/api/chat/health", (_req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      ok: false,
      message: "未配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY",
    });
  }
  res.json({ ok: true, model: DEFAULT_MODEL, baseUrl: OPENAI_BASE_URL });
});

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      error: { message: "呆呆 AI 对话服务未就绪" },
    });
  }

  const body = req.body || {};
  const payload = {
    model: body.model || DEFAULT_MODEL,
    messages: body.messages || [],
    max_tokens: body.max_tokens ?? 2000,
    temperature: body.temperature ?? 0.7,
    top_p: body.top_p ?? 0.9,
    stream: body.stream !== false,
  };

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return res.status(400).json({ error: { message: "messages 不能为空" } });
  }

  try {
    const upstream = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
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
      // 对外不暴露供应商名
      message = String(message).replace(
        /DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|Claude|API key/gi,
        "呆呆 AI"
      );
      return res.status(upstream.status).json({ error: { message } });
    }

    stats.chat += 1;

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
    res.status(502).json({
      error: { message: err instanceof Error ? err.message : "代理请求失败" },
    });
  }
});

app.post("/api/image", async (req, res) => {
  if (!IMAGE_API_KEY) {
    return res.status(503).json({
      error: {
        message: "呆呆 AI 生图服务未就绪",
      },
    });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    return res.status(400).json({ error: { message: "prompt 不能为空" } });
  }

  const size = body.size || "1024x1024";
  const model = body.model || IMAGE_MODEL;
  const payload = {
    model,
    prompt,
    size,
    n: 1,
  };

  try {
    const upstream = await fetch(`${IMAGE_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${IMAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text();
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
      return res.status(upstream.status).json({ error: { message } });
    }

    const item = data?.data?.[0] || {};
    let image = "";
    if (item.b64_json) {
      image = `data:image/png;base64,${item.b64_json}`;
    } else if (item.url) {
      image = item.url;
    }

    if (!image) {
      return res.status(502).json({ error: { message: "上游未返回图片数据" } });
    }

    stats.image += 1;
    res.json({
      ok: true,
      model,
      size,
      image,
      revised_prompt: item.revised_prompt || "",
    });
  } catch (err) {
    console.error("image proxy error:", err);
    res.status(502).json({
      error: { message: err instanceof Error ? err.message : "生图代理失败" },
    });
  }
});

/**
 * AI 改图：原图 + 文字指令 → gpt-image-2 /v1/images/edits
 * body: { prompt, image_b64, mime?, size?, model? }
 */
app.post("/api/image/edit", async (req, res) => {
  if (!IMAGE_API_KEY) {
    return res.status(503).json({
      error: {
        message: "呆呆 AI 改图服务未就绪",
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
  const dataUrl = imageB64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrl) {
    mime = dataUrl[1];
    imageB64 = dataUrl[2];
  }

  const size = body.size || "1024x1024";
  const model = body.model || IMAGE_MODEL;
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";

  try {
    const buf = Buffer.from(imageB64, "base64");
    if (!buf.length) {
      return res.status(400).json({ error: { message: "图片数据无效" } });
    }
    if (buf.length > 18 * 1024 * 1024) {
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
        headers: { Authorization: `Bearer ${IMAGE_API_KEY}` },
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
        return res.status(retry.upstream.status).json({ error: { message } });
      }
    }

    const item = data?.data?.[0] || {};
    let image = "";
    if (item.b64_json) {
      image = `data:image/png;base64,${item.b64_json}`;
    } else if (item.url) {
      image = item.url;
    }

    if (!image) {
      return res.status(502).json({ error: { message: "上游未返回图片数据" } });
    }

    stats.imageEdit += 1;
    res.json({
      ok: true,
      model,
      size,
      image,
      revised_prompt: item.revised_prompt || "",
    });
  } catch (err) {
    console.error("image edit proxy error:", err);
    res.status(502).json({
      error: { message: err instanceof Error ? err.message : "改图代理失败" },
    });
  }
});

const adminDir = path.join(__dirname, "admin");
app.use("/admin", express.static(adminDir));
app.get("/admin", (_req, res) => {
  res.redirect(301, "/admin/");
});

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
    `呆呆网络 listening on ${PORT}, chatConfigured=${Boolean(API_KEY)}, site=/, admin=/admin/`
  );
});
