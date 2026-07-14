Page({
  data: {
    statusBarHeight: 20,
    ready: false,
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    setTimeout(() => this.setData({ ready: true }), 40);
  },

  enterAi() {
    wx.navigateTo({ url: '/pages/ai/index' });
  },
});
