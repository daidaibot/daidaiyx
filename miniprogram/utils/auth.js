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

function saveSession({ token, openid, nickName, avatarUrl }) {
  const user = {
    openid,
    nickName: nickName || '微信用户',
    avatarUrl: avatarUrl || '',
    loggedInAt: Date.now(),
  };
  wx.setStorageSync(USER_KEY, user);
  wx.setStorageSync(TOKEN_KEY, token || openid);
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.user = user;
      app.globalData.token = token || openid;
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

/** wx.login + 后端换身份；无后端时也可本地登录（开发调试） */
function loginWithWeChat(profile = {}) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        const code = loginRes.code;
        if (!code) {
          reject(new Error('登录失败，请重试'));
          return;
        }

        let apiBase = '';
        try {
          apiBase = (getApp().globalData && getApp().globalData.apiBase) || '';
        } catch (e) {
          apiBase = '';
        }

        const payload = {
          code,
          nickName: profile.nickName || '',
          avatarUrl: profile.avatarUrl || '',
        };

        if (!apiBase) {
          // 无云托管域名时：本地会话（仍算已登录，方便开发）
          const openid = `local_${String(code).slice(0, 16)}`;
          const user = saveSession({
            token: `tk_${openid}`,
            openid,
            nickName: payload.nickName || '微信用户',
            avatarUrl: payload.avatarUrl || '',
          });
          resolve(user);
          return;
        }

        wx.request({
          url: `${apiBase.replace(/\/$/, '')}/api/auth/login`,
          method: 'POST',
          timeout: 20000,
          data: payload,
          success: (res) => {
            const data = res.data || {};
            if (!data.ok || !data.openid) {
              reject(new Error(data.error?.message || '登录失败'));
              return;
            }
            const user = saveSession({
              token: data.token || data.openid,
              openid: data.openid,
              nickName: data.nickName || payload.nickName || '微信用户',
              avatarUrl: data.avatarUrl || payload.avatarUrl || '',
            });
            resolve(user);
          },
          fail: () => reject(new Error('网络错误，请稍后再试')),
        });
      },
      fail: () => reject(new Error('微信登录不可用')),
    });
  });
}

module.exports = {
  getUser,
  getToken,
  isLoggedIn,
  saveSession,
  clearSession,
  loginWithWeChat,
};
