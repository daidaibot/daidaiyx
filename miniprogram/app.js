App({
  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.globalData.StatusBar = info.statusBarHeight || 20;
    const capsule = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : null;
    if (capsule) {
      this.globalData.Custom = capsule;
      this.globalData.CustomBar =
        capsule.bottom + capsule.top - this.globalData.StatusBar;
    } else {
      this.globalData.CustomBar = this.globalData.StatusBar + 50;
    }
  },
  globalData: {
    brand: '呆呆网络',
    StatusBar: 20,
    CustomBar: 70,
  },
});
