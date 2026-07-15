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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKENS = new Set();

const stats = {
  chat: 0,
  image: 0,
  imageEdit: 0,
  login: 0,
  startedAt: Date.now(),
};

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
 * 小程序登录：code → openid
 * 需配置 WECHAT_APPID + WECHAT_SECRET；未配置时开发态回落为本地会话
 */
app.post("/api/auth/login", async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || "").trim();
  if (!code) {
    return res.status(400).json({ ok: false, error: { message: "缺少登录凭证" } });
  }

  const nickName = String(body.nickName || "").trim() || "微信用户";
  const avatarUrl = String(body.avatarUrl || "").trim();

  try {
    if (WECHAT_APPID && WECHAT_SECRET) {
      const url =
        "https://api.weixin.qq.com/sns/jscode2session" +
        `?appid=${encodeURIComponent(WECHAT_APPID)}` +
        `&secret=${encodeURIComponent(WECHAT_SECRET)}` +
        `&js_code=${encodeURIComponent(code)}` +
        "&grant_type=authorization_code";
      const upstream = await fetch(url);
      const data = await upstream.json();
      if (!data.openid) {
        return res.status(401).json({
          ok: false,
          error: { message: "微信登录失败，请重试" },
        });
      }
      stats.login += 1;
      return res.json({
        ok: true,
        openid: data.openid,
        token: `wx_${data.openid}_${hashCode(data.session_key || code)}`,
        nickName,
        avatarUrl,
      });
    }

    // 开发态：无小程序密钥时也允许登录，便于联调
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
  } catch (err) {
    console.error("auth login error:", err);
    return res.status(502).json({
      ok: false,
      error: { message: "登录服务繁忙，请稍后再试" },
    });
  }
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
