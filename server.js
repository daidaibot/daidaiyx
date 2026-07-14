const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 80;

const OPENAI_BASE_URL = (
  process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
).replace(/\/$/, "");
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.CHAT_MODEL || "deepseek-chat";

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "daidaiyx",
    brand: "呆呆网络",
    chatConfigured: Boolean(API_KEY),
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
      error: { message: "服务未配置 API Key，请在云托管环境变量中设置 DEEPSEEK_API_KEY" },
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
      let message = `上游模型错误 ${upstream.status}`;
      try {
        const parsed = JSON.parse(errText);
        message = parsed?.error?.message || message;
      } catch {
        if (errText) message = errText.slice(0, 300);
      }
      return res.status(upstream.status).json({ error: { message } });
    }

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

const distDir = path.join(__dirname, "web-ui", "dist");
app.use(express.static(distDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) {
      res
        .status(503)
        .type("html")
        .send(
          "<h1>呆呆网络</h1><p>前端尚未构建。请在部署前执行 <code>npm run build:ui</code>。</p>"
        );
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`呆呆网络 listening on ${PORT}, chatConfigured=${Boolean(API_KEY)}`);
});
