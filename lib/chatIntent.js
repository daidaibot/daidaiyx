const { outboundFetch } = require("./outbound");

const VALID = new Set(["chat", "image_generate", "image_edit"]);

function parseJsonFromModel(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeIntent(parsed, hasRecentImage) {
  let intent = String((parsed && parsed.intent) || "chat")
    .trim()
    .toLowerCase();
  if (!VALID.has(intent)) intent = "chat";
  if (intent === "image_edit" && !hasRecentImage) intent = "chat";
  let prompt = String((parsed && parsed.prompt) || "").trim();
  if (intent === "chat") prompt = "";
  let confidence = Number(parsed && parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = intent === "chat" ? 0.5 : 0.7;
  confidence = Math.max(0, Math.min(1, confidence));
  return { intent, prompt, confidence };
}

/**
 * 用对话模型分析用户是否有生图/改图意向（非关键词规则）
 */
async function analyzeUserIntent({ text, hasRecentImage, chatKey, chatBaseUrl, model }) {
  const message = String(text || "").trim();
  if (!message) {
    return { intent: "chat", prompt: "", confidence: 1 };
  }
  if (!chatKey) {
    const err = new Error("呆呆 AI 对话服务未就绪");
    err.code = "NO_CHAT_KEY";
    throw err;
  }

  const base = String(chatBaseUrl || "").replace(/\/$/, "");
  const system = [
    "你是小程序里的意图分类器，只输出 JSON，不要输出其它文字。",
    "根据用户最后一条消息判断意图：",
    "- image_generate：用户想生成新的图片/海报/照片/插画/壁纸/logo/头像/宣传图等（文生图，不是改已有图）",
    "- image_edit：用户想修改对话里上一张已展示的图片（仅当 hasRecentImage 为 true，且明确是在上一张/这张图基础上改）",
    "- chat：普通聊天、问答、写作、编程、翻译、闲聊、咨询，或意图不明确",
    "",
    "输出格式（严格 JSON）：",
    '{"intent":"chat|image_generate|image_edit","prompt":"","confidence":0.0}',
    "",
    "规则：",
    "- prompt：仅 image_generate / image_edit 时填写，提取简洁中文生图或改图描述，去掉「帮我」「请」等礼貌词",
    "- 不要假设图片已经生成或修改成功",
    "- 用户只是在讨论图片、问问题、要文案，选 chat",
    "- 有歧义时选 chat",
  ].join("\n");

  const upstream = await outboundFetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            hasRecentImage: !!hasRecentImage,
            message,
          }),
        },
      ],
      max_tokens: 160,
      temperature: 0.1,
      stream: false,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    const err = new Error(`意图分析失败（${upstream.status}）`);
    err.code = "INTENT_UPSTREAM";
    err.detail = errText.slice(0, 200);
    throw err;
  }

  const data = await upstream.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonFromModel(content);
  if (!parsed) {
    const err = new Error("意图分析返回格式无效");
    err.code = "INTENT_PARSE";
    throw err;
  }
  return normalizeIntent(parsed, hasRecentImage);
}

module.exports = {
  analyzeUserIntent,
  parseJsonFromModel,
  normalizeIntent,
};
