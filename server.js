const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 80;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（云托管探活常用）
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'daidaiyx', ts: Date.now() });
});

app.get('/api/hello', (_req, res) => {
  res.json({ message: '呆呆网络 · 云托管已就绪' });
});

// SPA 兜底：其余路径回首页游戏
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`daidaiyx listening on ${PORT}`);
});
