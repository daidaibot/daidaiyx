/**
 * 聊天历史：以服务端数据库为准；本地仅内存缓存当前列表，不写 wx.storage
 */
const historySync = require("./historySync");
const auth = require("./auth");

const MAX_SESSIONS = 40;
const MAX_MESSAGES = 120;

/** @type {Array<{id:string,title:string,preview:string,updatedAt:number}>} */
let memoryIndex = [];
/** @type {Map<string, object>} */
const memorySessions = new Map();

function getOpenId() {
  try {
    const user = auth.getUser && auth.getUser();
    if (user && user.openid) return user.openid;
    const cached = wx.getStorageSync("daidai_user");
    return (cached && cached.openid) || "";
  } catch (e) {
    return "";
  }
}

function clearLocalCache() {
  memoryIndex = [];
  memorySessions.clear();
}

function sanitizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && m.id && (m.content || m.image) && !m.loading)
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      id: m.id,
      role: m.role === "user" ? "user" : "ai",
      content: m.content || "",
      image: m.image || "",
      quote: m.quote || null,
      imagePrompt: m.imagePrompt || "",
      imageKind: m.imageKind || "",
    }));
}

function titleFromMessages(messages) {
  const firstUser = (messages || []).find((m) => m.role === "user" && m.content);
  if (!firstUser) return "新对话";
  return (
    String(firstUser.content)
      .replace(/^🎨\s*/g, "")
      .replace(/^🖌️\s*/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20) || "新对话"
  );
}

function previewFromMessages(messages) {
  const last = (messages || []).slice().reverse().find((m) => m.content || m.image);
  if (!last) return "";
  if (last.image && !last.content) return "[图片]";
  return String(last.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function updateMemoryIndex(list) {
  memoryIndex = (list || []).slice(0, MAX_SESSIONS);
  return memoryIndex;
}

function putMemorySession(body) {
  if (!body || !body.id) return;
  memorySessions.set(body.id, body);
  const list = memoryIndex.filter((s) => s.id !== body.id);
  list.unshift({
    id: body.id,
    title: body.title,
    preview: body.preview,
    updatedAt: body.updatedAt || Date.now(),
  });
  updateMemoryIndex(list);
}

/**
 * 保存完整会话到数据库
 * payload: { id, messages, meta }
 */
function saveSession(payload) {
  if (!payload || !payload.id) return memoryIndex.slice();

  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) return memoryIndex.slice();

  const title = payload.title || titleFromMessages(messages);
  const preview = payload.preview || previewFromMessages(messages);
  const updatedAt = Date.now();
  const body = {
    id: payload.id,
    title,
    preview,
    updatedAt,
    messages,
    meta: {
      activeSkill: (payload.meta && payload.meta.activeSkill) || "",
      skillLabel: (payload.meta && payload.meta.skillLabel) || "",
      activeMask: (payload.meta && payload.meta.activeMask) || "",
      maskLabel: (payload.meta && payload.meta.maskLabel) || "",
      maskPrompt: (payload.meta && payload.meta.maskPrompt) || "",
      welcomeEmoji: (payload.meta && payload.meta.welcomeEmoji) || "呆",
      navSub: (payload.meta && payload.meta.navSub) || "随时帮忙",
      imageSize: (payload.meta && payload.meta.imageSize) || "1152x1536",
    },
  };

  putMemorySession(body);

  if (auth.isLoggedIn()) {
    historySync
      .pushSession(body)
      .then((remote) => {
        if (remote && remote.length) updateMemoryIndex(remote);
      })
      .catch((e) => console.warn("pushSession failed", e && e.message));
  }

  return memoryIndex.slice();
}

function getSession(id) {
  if (!id) return null;
  const hit = memorySessions.get(id);
  if (!hit) return null;
  return {
    id: hit.id,
    title: hit.title || "对话",
    preview: hit.preview || "",
    updatedAt: hit.updatedAt || 0,
    messages: Array.isArray(hit.messages) ? hit.messages : [],
    meta: hit.meta || {},
  };
}

function removeSession(id) {
  if (!id) return memoryIndex.slice();
  memorySessions.delete(id);
  updateMemoryIndex(memoryIndex.filter((s) => s.id !== id));
  if (auth.isLoggedIn()) {
    historySync
      .removeRemoteSession(id)
      .then((remote) => {
        if (remote && Array.isArray(remote)) updateMemoryIndex(remote);
      })
      .catch((e) => console.warn("removeRemoteSession failed", e && e.message));
  }
  return memoryIndex.slice();
}

function clearHistory() {
  clearLocalCache();
}

function loadHistory() {
  return memoryIndex.slice();
}

async function loadHistoryFromServer() {
  if (!auth.isLoggedIn()) {
    clearLocalCache();
    return [];
  }
  const remote = await historySync.fetchSessions();
  if (!remote) return memoryIndex.slice();
  updateMemoryIndex(remote);
  return memoryIndex.slice();
}

async function openSessionFromServer(id) {
  if (!id) return null;
  if (auth.isLoggedIn()) {
    const remote = await historySync.fetchSession(id);
    if (remote && remote.id) {
      putMemorySession(remote);
      return remote;
    }
  }
  return getSession(id);
}

async function syncAllLocalToServer() {
  // 兼容旧调用：以服务端列表为准
  return loadHistoryFromServer();
}

function upsertSession(session) {
  if (!session || !session.id) return memoryIndex.slice();
  const exist = getSession(session.id);
  return saveSession({
    id: session.id,
    title: session.title,
    preview: session.preview,
    messages: (exist && exist.messages) || [],
    meta: (exist && exist.meta) || {},
  });
}

module.exports = {
  loadHistory,
  loadHistoryFromServer,
  openSessionFromServer,
  syncAllLocalToServer,
  loadIndex: loadHistory,
  saveSession,
  getSession,
  removeSession,
  clearHistory,
  clearLocalCache,
  upsertSession,
  titleFromMessages,
  previewFromMessages,
  getOpenId,
};
