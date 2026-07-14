Page({
  data: {
    statusBarHeight: 20,
    url: '',
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const url = (getApp().globalData.aiUrl || '').trim();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      url,
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  openBrowser() {
    const url = this.data.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
    });
  },
});
