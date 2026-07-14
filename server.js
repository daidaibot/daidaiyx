const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 80;

app.use(express.json({ limit: '1mb' }));

// 允许小程序 / 浏览器调试
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'daidaiyx', brand: '呆呆网络', ts: Date.now() });
});

app.get('/api/hello', (_req, res) => {
  res.json({ message: '呆呆网络 · 云托管已就绪' });
});

/**
 * 微信小程序 AI 对话代理
 * 环境变量（在微信云托管「服务设置」里配置，不要写进代码）：
 * - AI_PROVIDER=deepseek | openai（可选，有 DeepSeek Key 时默认 deepseek）
 * - DEEPSEEK_API_KEY 或 OPENAI_API_KEY
 * - AI_MODEL 可选，如 deepseek-chat / gpt-4o-mini
 */
app.post('/api/chat', async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    const chatMessages = messages && messages.length
      ? messages
      : content
        ? [
            {
              role: 'system',
              content:
                '你是「呆呆网络」的智能助手，回答简洁有用，语气友好。用户正在使用微信小程序。',
            },
            { role: 'user', content },
          ]
        : null;

    if (!chatMessages) {
      return res.status(400).json({ error: '请提供 content 或 messages' });
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY || '';
    const openaiKey = process.env.OPENAI_API_KEY || '';
    const provider =
      (process.env.AI_PROVIDER || (deepseekKey ? 'deepseek' : 'openai')).toLowerCase();

    const apiKey = provider === 'deepseek' ? deepseekKey : openaiKey;
    if (!apiKey) {
      return res.status(500).json({
        error: '服务端未配置 API Key',
        hint: '请在微信云托管环境变量中设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY',
      });
    }

    const baseUrl =
      process.env.AI_BASE_URL ||
      (provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com');
    const model =
      process.env.AI_MODEL || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');

    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        temperature: 0.7,
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: '上游模型调用失败',
        detail: data.error || data,
      });
    }

    const reply = data.choices?.[0]?.message?.content || '';
    return res.json({
      reply,
      model,
      provider,
      usage: data.usage || null,
    });
  } catch (err) {
    console.error('chat error', err);
    return res.status(500).json({ error: '服务器异常', detail: String(err.message || err) });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`daidaiyx listening on ${PORT}`);
});
