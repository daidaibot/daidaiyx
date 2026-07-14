Page({
  data: {
    statusBarHeight: 20,
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },
  open2() {
    wx.navigateTo({ url: '/pages/p2-colorui/index' });
  },
  open4() {
    wx.navigateTo({ url: '/pages/p4-aitools/index' });
  },
  openChat() {
    wx.navigateTo({ url: '/pages/chat/index' });
  },
});
