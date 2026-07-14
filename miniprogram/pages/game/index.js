Page({
  openGame() {
    const apiBase = (getApp().globalData.apiBase || '').replace(/\/$/, '');
    if (!apiBase) {
      wx.showModal({
        title: '未配置域名',
        content: '请先在 app.js 的 globalData.apiBase 填入云托管公网域名。',
        showCancel: false,
      });
      return;
    }
    wx.setClipboardData({
      data: apiBase,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      },
    });
  },
});
