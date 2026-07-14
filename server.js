const express = require("express");
const app = express();
const PORT = Number(process.env.PORT) || 80;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "daidaiyx", brand: "呆呆网络", note: "AI 在微信小程序云开发 Agent UI" });
});

app.get("/", (_req, res) => {
  res.type("html").send("<h1>呆呆网络</h1><p>请使用微信小程序体验 AI</p>");
});

app.listen(PORT, "0.0.0.0", () => console.log(`listening ${PORT}`));
