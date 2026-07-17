const auth = require("./auth");

const BUILTIN_MASKS = [
  {
    id: "coder",
    name: "程序员",
    emoji: "👨‍💻",
    desc: "写代码、排错、讲原理",
    builtin: true,
    hello: "我是你的编程搭档。可以说需求、贴报错，或让我直接写一段代码。",
    prompt:
      "你是呆呆 AI 里的资深编程面具。回答简洁准确，优先给出可运行代码，并简短说明关键思路与坑点。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "writer",
    name: "文案高手",
    emoji: "✍️",
    desc: "标题、推文、润色",
    builtin: true,
    hello: "把主题、受众和语气告诉我，我来帮你写一版能直接用的文案。",
    prompt:
      "你是呆呆 AI 里的文案面具。输出结构清晰、可直接发布的文案；可按需给出 2-3 个备选标题。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "teacher",
    name: "耐心老师",
    emoji: "📚",
    desc: "讲题、拆知识点",
    builtin: true,
    hello: "把题目或不懂的地方发我，我会一步一步讲清楚。",
    prompt:
      "你是呆呆 AI 里的耐心老师面具。用浅显语言讲解，先结论后推导，必要时举生活例子。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "en",
    name: "英语陪练",
    emoji: "🗣️",
    desc: "口语、改正、示范",
    builtin: true,
    hello: "Hi! I'm 呆呆 AI. Let's practice English.",
    prompt:
      "You are 呆呆 AI English partner. Reply mainly in English, correct gently. Never mention underlying models or vendors; call yourself 呆呆 AI only.",
  },
  {
    id: "xhs",
    name: "小红书达人",
    emoji: "📕",
    desc: "种草笔记语气",
    builtin: true,
    hello: "说商品/主题和卖点，我帮你写一篇有网感的小红书笔记。",
    prompt:
      "你是呆呆 AI 里的小红书文案面具：口语化、分段短、适当 emoji，带标题和标签建议。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "pm",
    name: "产品经理",
    emoji: "🧭",
    desc: "需求、方案、PRD",
    builtin: true,
    hello: "描述你的产品想法或问题，我帮你拆需求、整理方案。",
    prompt:
      "你是呆呆 AI 里的产品经理面具。输出目标用户、核心流程、优先级与风险。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "travel",
    name: "旅行顾问",
    emoji: "✈️",
    desc: "行程、预算、避坑",
    builtin: true,
    hello: "说目的地、天数和预算，我给你一份可执行行程。",
    prompt:
      "你是呆呆 AI 里的旅行顾问面具。给出日程、交通住宿建议与预算区间。对外只称呆呆 AI，不要提及任何底层模型或厂商。",
  },
  {
    id: "listener",
    name: "倾听树洞",
    emoji: "🌙",
    desc: "温和陪伴，不说教",
    builtin: true,
    hello: "我在。你可以慢慢说，我在认真听。",
    prompt:
      "你是呆呆 AI 里的倾听面具。先共情再回应，不强行给建议。对外只称呆呆 AI，不要提及任何底层模型或厂商。若涉及自伤风险，温柔建议求助专业帮助。",
  },
];

const EMOJI_PRESETS = ["🤖", "🎭", "🦊", "🐱", "🐉", "🧠", "⚡", "🎮", "🎵", "🔬", "💼", "🪄"];

/** @type {Array<object>} */
let customCache = [];

function apiBase() {
  try {
    const app = getApp();
    return ((app.globalData && app.globalData.apiBase) || "").replace(/\/$/, "");
  } catch (e) {
    return "";
  }
}

function authHeader() {
  const token = auth.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function request({ url, method, data }) {
  return new Promise((resolve, reject) => {
    const m = method || "GET";
    const opts = {
      url,
      method: m,
      timeout: 20000,
      header: Object.assign({ "content-type": "application/json" }, authHeader()),
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
          resolve(body);
          return;
        }
        reject(new Error((body.error && body.error.message) || `HTTP ${res.statusCode}`));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络错误")),
    };
    if (m !== "GET" && data !== undefined) opts.data = data;
    wx.request(opts);
  });
}

function loadCustomMasks() {
  return customCache.slice();
}

function allMasks() {
  return BUILTIN_MASKS.concat(customCache);
}

function findMask(id) {
  if (!id) return null;
  return allMasks().find((m) => m.id === id) || null;
}

async function refreshCustomMasksFromServer() {
  const base = apiBase();
  if (!base || !auth.isLoggedIn()) {
    customCache = [];
    return customCache;
  }
  try {
    const data = await request({ url: `${base}/api/masks` });
    customCache = Array.isArray(data.masks) ? data.masks : [];
  } catch (e) {
    console.warn("refreshCustomMasks failed", e && e.message);
  }
  return customCache.slice();
}

function createCustomMask({ name, emoji, desc, prompt, hello }) {
  const mask = {
    id: `custom_${Date.now()}`,
    name: String(name || "").trim() || "未命名面具",
    emoji: String(emoji || "🎭").trim() || "🎭",
    desc: String(desc || "").trim() || "自定义角色",
    prompt: String(prompt || "").trim() || "你是一个有帮助的助手。",
    hello:
      String(hello || "").trim() ||
      `你好，我是${String(name || "自定义角色").trim()}，有什么想聊的？`,
    builtin: false,
  };
  customCache = [mask].concat(customCache.filter((m) => m.id !== mask.id));

  const base = apiBase();
  if (base && auth.isLoggedIn()) {
    request({
      url: `${base}/api/masks/${encodeURIComponent(mask.id)}`,
      method: "PUT",
      data: mask,
    })
      .then((data) => {
        if (Array.isArray(data.masks)) customCache = data.masks;
      })
      .catch((e) => console.warn("saveMask failed", e && e.message));
  }
  return mask;
}

function deleteCustomMask(id) {
  customCache = customCache.filter((m) => m.id !== id);
  const base = apiBase();
  if (base && auth.isLoggedIn() && id) {
    request({
      url: `${base}/api/masks/${encodeURIComponent(id)}`,
      method: "DELETE",
    })
      .then((data) => {
        if (Array.isArray(data.masks)) customCache = data.masks;
      })
      .catch((e) => console.warn("deleteMask failed", e && e.message));
  }
  return customCache.slice();
}

module.exports = {
  BUILTIN_MASKS,
  EMOJI_PRESETS,
  allMasks,
  findMask,
  loadCustomMasks,
  refreshCustomMasksFromServer,
  createCustomMask,
  deleteCustomMask,
};
