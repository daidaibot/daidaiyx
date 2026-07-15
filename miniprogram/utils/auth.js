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

/** wx.login → 后端 code2session；必须走微信 + 已配置的云托管，禁止本地假登录 */
function loginWithWeChat(profile = {}) {
  return new Promise((resolve, reject) => {
    let apiBase = '';
    try {
      apiBase = (getApp().globalData && getApp().globalData.apiBase) || '';
    } catch (e) {
      apiBase = '';
    }

    if (!apiBase) {
      reject(new Error('未连接云托管，无法微信登录'));
      return;
    }

    wx.login({
      success: (loginRes) => {
        const code = loginRes.code;
        if (!code) {
          reject(new Error('未拿到微信登录凭证，请重试'));
          return;
        }

        wx.request({
          url: `${apiBase.replace(/\/$/, '')}/api/auth/login`,
          method: 'POST',
          timeout: 20000,
          data: {
            code,
            nickName: profile.nickName || '',
            avatarUrl: profile.avatarUrl || '',
          },
          success: (res) => {
            const data = res.data || {};
            if (!data.ok || !data.openid || data.dev) {
              reject(
                new Error(
                  data.error?.message ||
                    '微信登录未配置，请在云托管设置 WECHAT_APPID / WECHAT_SECRET'
                )
              );
              return;
            }
            const user = saveSession({
              token: data.token || data.openid,
              openid: data.openid,
              nickName: data.nickName || profile.nickName || '微信用户',
              avatarUrl: data.avatarUrl || profile.avatarUrl || '',
            });
            resolve(user);
          },
          fail: () => reject(new Error('网络错误，请稍后再试')),
        });
      },
      fail: () => reject(new Error('请在微信内使用微信登录')),
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
