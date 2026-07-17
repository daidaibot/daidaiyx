const USER_KEY = 'daidai_user';
const TOKEN_KEY = 'daidai_token';

function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isLoggedIn() {
  const u = getUser();
  return !!(u && u.openid && getToken());
}

function saveSession(payload) {
  const user = {
    openid: payload.openid,
    nickName: payload.nickName || '用户',
    avatarUrl: payload.avatarUrl || '',
    phone: payload.phone || '',
    email: payload.email || '',
    platform: payload.platform || 'account',
    loggedInAt: Date.now(),
  };
  wx.setStorageSync(USER_KEY, user);
  wx.setStorageSync(TOKEN_KEY, payload.token || payload.openid);
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.user = user;
      app.globalData.token = payload.token || payload.openid;
    }
  } catch (e) {
    /* ignore */
  }
  return user;
}

function clearSession() {
  try {
    wx.removeStorageSync(USER_KEY);
    wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.user = null;
      app.globalData.token = '';
    }
  } catch (e) {
    /* ignore */
  }
}

function apiBase() {
  try {
    return ((getApp().globalData && getApp().globalData.apiBase) || '').replace(/\/$/, '');
  } catch (e) {
    return '';
  }
}

function postAuth(path, data, retry = 1) {
  return new Promise((resolve, reject) => {
    const base = apiBase();
    if (!base) {
      reject(new Error('未连接服务器，请检查 apiBase'));
      return;
    }
    wx.request({
      url: `${base}${path}`,
      method: 'POST',
      timeout: 30000,
      header: { 'content-type': 'application/json' },
      data: data || {},
      success: (res) => {
        let body = res.data;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (e) {
            body = {};
          }
        }
        body = body || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.ok) {
          resolve(body);
          return;
        }
        // 503（实例冷启动 / 数据库唤醒中）自动重试一次
        if (res.statusCode === 503 && retry > 0) {
          setTimeout(() => postAuth(path, data, retry - 1).then(resolve, reject), 1500);
          return;
        }
        reject(
          new Error(
            (body.error && body.error.message) ||
              body.message ||
              `请求失败(${res.statusCode})`
          )
        );
      },
      fail: (err) => {
        // 网络错误 / 超时（多为冷启动）自动重试一次
        if (retry > 0) {
          setTimeout(() => postAuth(path, data, retry - 1).then(resolve, reject), 1500);
          return;
        }
        reject(new Error((err && err.errMsg) || '网络错误，请稍后再试'));
      },
    });
  });
}

function sendLoginCode(account) {
  return postAuth('/api/auth/send-code', { account });
}

function loginWithCode(account, code) {
  return postAuth('/api/auth/code-login', { account, code }).then((body) => {
    if (!body.openid) return Promise.reject(new Error('登录失败'));
    return saveSession(body);
  });
}

module.exports = {
  getUser,
  getToken,
  isLoggedIn,
  saveSession,
  clearSession,
  sendLoginCode,
  loginWithCode,
  authHeader,
};
