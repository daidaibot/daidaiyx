function getApiBase() {
  try {
    const app = getApp();
    return ((app.globalData && app.globalData.apiBase) || '').replace(/\/$/, '');
  } catch (e) {
    return '';
  }
}

/** 拉取公开状态；维护中时弹窗并返回 false */
function checkServiceReady(opts = {}) {
  const showModal = opts.showModal !== false;
  const base = getApiBase();
  if (!base) {
    return Promise.resolve({ ok: true, skipped: true });
  }
  return new Promise((resolve) => {
    wx.request({
      url: `${base}/api/public/status`,
      method: 'GET',
      timeout: 8000,
      success: (res) => {
        const data = res.data || {};
        if (data.maintenance) {
          const msg = data.message || '呆呆 AI 维护中，请稍后再试';
          if (showModal) {
            wx.showModal({
              title: '维护中',
              content: msg,
              showCancel: false,
            });
          }
          resolve({ ok: false, maintenance: true, message: msg, data });
          return;
        }
        resolve({ ok: true, data });
      },
      fail: () => resolve({ ok: true, offline: true }),
    });
  });
}

module.exports = {
  getApiBase,
  checkServiceReady,
};
