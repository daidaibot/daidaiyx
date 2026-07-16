const auth = require("./auth");

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
        // 404：后端尚未部署聊天同步接口，静默回落本地
        if (res.statusCode === 404) {
          reject(new Error("NOT_DEPLOYED"));
          return;
        }
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

async function fetchSessions() {
  const base = apiBase();
  if (!base || !auth.isLoggedIn()) return null;
  try {
    const data = await request({ url: `${base}/api/chat/sessions` });
    return data.sessions || [];
  } catch (e) {
    if (e.message !== "NOT_DEPLOYED") {
      console.warn("fetchSessions failed", e.message);
    }
    return null;
  }
}

async function fetchSession(id) {
  const base = apiBase();
  if (!base || !auth.isLoggedIn() || !id) return null;
  try {
    const data = await request({
      url: `${base}/api/chat/sessions/${encodeURIComponent(id)}`,
    });
    return data.session || null;
  } catch (e) {
    if (e.message !== "NOT_DEPLOYED") {
      console.warn("fetchSession failed", e.message);
    }
    return null;
  }
}

async function pushSession(payload) {
  const base = apiBase();
  if (!base || !auth.isLoggedIn() || !payload || !payload.id) return null;
  try {
    const data = await request({
      url: `${base}/api/chat/sessions/${encodeURIComponent(payload.id)}`,
      method: "PUT",
      data: {
        title: payload.title,
        preview: payload.preview,
        messages: payload.messages,
        meta: payload.meta,
      },
    });
    return data.sessions || null;
  } catch (e) {
    if (e.message !== "NOT_DEPLOYED") {
      console.warn("pushSession failed", e.message);
    }
    return null;
  }
}

async function removeRemoteSession(id) {
  const base = apiBase();
  if (!base || !auth.isLoggedIn() || !id) return null;
  try {
    const data = await request({
      url: `${base}/api/chat/sessions/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
    return data.sessions || null;
  } catch (e) {
    if (e.message !== "NOT_DEPLOYED") {
      console.warn("removeRemoteSession failed", e.message);
    }
    return null;
  }
}

async function syncLocalSessions(localSessions) {
  const base = apiBase();
  if (!base || !auth.isLoggedIn() || !Array.isArray(localSessions) || !localSessions.length) {
    return null;
  }
  try {
    const data = await request({
      url: `${base}/api/chat/sync`,
      method: "POST",
      data: { sessions: localSessions },
    });
    return data.sessions || null;
  } catch (e) {
    if (e.message !== "NOT_DEPLOYED") {
      console.warn("syncLocalSessions failed", e.message);
    }
    return null;
  }
}

module.exports = {
  fetchSessions,
  fetchSession,
  pushSession,
  removeRemoteSession,
  syncLocalSessions,
};
