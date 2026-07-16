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

function postAuth(path, data) {
  return new Promise((resolve, reject) => {
    const base = apiBase();
    if (!base) {
      reject(new Error('未连接服务器'));
      return;
    }
    wx.request({
      url: `${base}${path}`,
      method: 'POST',
      timeout: 20000,
      data: data || {},
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.ok && body.openid) {
          resolve(saveSession(body));
          return;
        }
        reject(new Error((body.error && body.error.message) || `登录失败(${res.statusCode})`));
      },
      fail: () => reject(new Error('网络错误，请稍后再试')),
    });
  });
}

/** 手机号或邮箱 + 密码登录 */
function loginWithAccount({ account, password }) {
  return postAuth('/api/auth/account-login', { account, password });
}

/** 注册 */
function registerAccount({ account, password, nickName }) {
  return postAuth('/api/auth/register', { account, password, nickName });
}

/** 微信一键手机号登录 */
function loginWithPhoneCode(code) {
  return postAuth('/api/auth/phone-login', { code });
}

/** 兼容旧调用名 */
function loginWithWeChat(profile = {}) {
  if (profile.account && profile.password) {
    return loginWithAccount(profile);
  }
  return Promise.reject(new Error('请使用手机号或邮箱登录'));
}

module.exports = {
  getUser,
  getToken,
  isLoggedIn,
  saveSession,
  clearSession,
  loginWithAccount,
  registerAccount,
  loginWithPhoneCode,
  loginWithWeChat,
};
