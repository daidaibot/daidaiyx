Page({
  data: {
    starCount: '12.4k',
    forksCount: '2.2k',
    visitTotal: '24k',
  },
  goChat() {
    wx.navigateTo({ url: '/pages/chat/index' });
  },
  goHome4() {
    wx.redirectTo({ url: '/pages/p4-aitools/index' });
  },
  goIndex() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },
});
