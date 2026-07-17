/**
 * 火山方舟 · 豆包视觉识图（仅识图，不用于生图/改图）
 * POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
 */
const { outboundFetch } = require("./outbound");

const DEFAULT_ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
/** 与方舟快速入门一致：Doubao-Seed-1.6-Vision；也可填控制台推理接入点 ep-xxx */
const DEFAULT_VISION_MODEL = "doubao-seed-1-6-vision-250815";

function arkBase() {
  return String(
    process.env.DOUBAO_ARK_BASE_URL ||
      process.env.ARK_BASE_URL ||
      process.env.DAIDAI_DOUBAO_BASE_URL ||
      DEFAULT_ARK_BASE
  ).replace(/\/$/, "");
}

function visionModel() {
  return (
    process.env.DOUBAO_VISION_MODEL ||
    process.env.ARK_VISION_MODEL ||
    process.env.DAIDAI_DOUBAO_VISION_MODEL ||
    DEFAULT_VISION_MODEL
  );
}

function getApiKey(explicit) {
  return String(
    explicit ||
      process.env.DOUBAO_ARK_API_KEY ||
      process.env.ARK_API_KEY ||
      process.env.DOUBAO_API_KEY ||
      process.env.DAIDAI_DOUBAO_KEY ||
      ""
  ).trim();
}

function isConfigured(explicitKey) {
  return Boolean(getApiKey(explicitKey));
}

async function parseJsonResponse(upstream) {
  const raw = await upstream.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  return { raw, data };
}

/**
 * 识图：多模态对话，描述/回答关于图片的问题
 */
async function visionChat({ apiKey, prompt, imageB64, mime, imageUrl }) {
  const key = getApiKey(apiKey);
  if (!key) {
    const err = new Error("豆包 Ark API Key 未配置（识图专用）");
    err.status = 503;
    throw err;
  }
  const text = String(prompt || "请详细描述这张图片的内容。").trim();
  let imagePart;
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    imagePart = { type: "image_url", image_url: { url: imageUrl } };
  } else if (imageB64) {
    const clean = String(imageB64).replace(/\s+/g, "");
    const type = mime || "image/jpeg";
    imagePart = {
      type: "image_url",
      image_url: { url: `data:${type};base64,${clean}` },
    };
  } else {
    const err = new Error("请提供要识别的图片");
    err.status = 400;
    throw err;
  }

  const upstream = await outboundFetch(`${arkBase()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: visionModel(),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text }, imagePart],
        },
      ],
      max_tokens: 1200,
      temperature: 0.3,
      stream: false,
    }),
  });
  const { raw, data } = await parseJsonResponse(upstream);
  if (!upstream.ok) {
    const message =
      (data && data.error && data.error.message) ||
      (raw && raw.slice(0, 300)) ||
      `豆包识图错误 ${upstream.status}`;
    const err = new Error(message);
    err.status = upstream.status;
    throw err;
  }
  const content =
    (data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    "";
  if (!content) {
    const err = new Error("豆包未返回识图结果");
    err.status = 502;
    throw err;
  }
  return {
    content: String(content),
    model: visionModel(),
    provider: "doubao",
  };
}

module.exports = {
  arkBase,
  visionModel,
  getApiKey,
  isConfigured,
  visionChat,
};
