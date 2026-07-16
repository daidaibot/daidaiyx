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

function readAvatarBase64(filePath) {
  return new Promise((resolve) => {
    const p = String(filePath || '').trim();
    if (!p || /^https?:\/\//i.test(p)) {
      resolve('');
      return;
    }
    try {
      wx.getFileSystemManager().readFile({
        filePath: p,
        encoding: 'base64',
        success: (res) => resolve(String(res.data || '')),
        fail: () => resolve(''),
      });
    } catch (e) {
      resolve('');
    }
  });
}

function persistAvatarLocal(tempPath, openid) {
  return new Promise((resolve) => {
    const src = String(tempPath || '').trim();
    if (!src || /^https?:\/\//i.test(src)) {
      resolve(src);
      return;
    }
    const dest = `${wx.env.USER_DATA_PATH}/avatar_${String(openid || 'me').replace(/[^\w-]/g, '')}.jpg`;
    try {
      wx.getFileSystemManager().saveFile({
        tempFilePath: src,
        filePath: dest,
        success: (res) => resolve((res && res.savedFilePath) || dest),
        fail: () => {
          try {
            wx.getFileSystemManager().copyFile({
              srcPath: src,
              destPath: dest,
              success: () => resolve(dest),
              fail: () => resolve(src),
            });
          } catch (e) {
            resolve(src);
          }
        },
      });
    } catch (e) {
      resolve(src);
    }
  });
}

/** wx.login → 后端 code2session；昵称/头像由用户点选后传入 */
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

    const nickName = String(profile.nickName || '').trim();
    const avatarUrl = String(profile.avatarUrl || '').trim();
    if (!nickName) {
      reject(new Error('请填写微信昵称'));
      return;
    }

    wx.login({
      success: (loginRes) => {
        const code = loginRes.code;
        if (!code) {
          reject(new Error('未拿到微信登录凭证，请重试'));
          return;
        }

        readAvatarBase64(avatarUrl).then((avatarBase64) => {
          wx.request({
            url: `${apiBase.replace(/\/$/, '')}/api/auth/login`,
            method: 'POST',
            timeout: 20000,
            data: {
              code,
              nickName,
              avatarUrl: /^https?:\/\//i.test(avatarUrl) ? avatarUrl : '',
              avatarBase64: avatarBase64 || '',
            },
            success: (res) => {
              const data = res.data || {};
              if (!data.ok || !data.openid || data.dev) {
                reject(
                  new Error(
                    (data.error && data.error.message) ||
                      '微信登录未配置，请在云托管设置 WECHAT_APPID / WECHAT_SECRET'
                  )
                );
                return;
              }
              const remoteAvatar = String(data.avatarUrl || '').trim();
              const finish = (localAvatar) => {
                const user = saveSession({
                  token: data.token || data.openid,
                  openid: data.openid,
                  nickName: data.nickName || nickName,
                  avatarUrl: remoteAvatar || localAvatar || avatarUrl,
                });
                resolve(user);
              };
              if (remoteAvatar) {
                finish(remoteAvatar);
              } else {
                persistAvatarLocal(avatarUrl, data.openid).then(finish);
              }
            },
            fail: () => reject(new Error('网络错误，请稍后再试')),
          });
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
