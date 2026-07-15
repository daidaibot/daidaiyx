App({
  globalData: {
    brand: '呆呆网络',
    product: '呆呆 AI',
    user: null,
    token: '',
    // 云托管公网域名（不要末尾斜杠）
    apiBase: '',
  },
  onLaunch() {
    try {
      const user = wx.getStorageSync('daidai_user');
      const token = wx.getStorageSync('daidai_token');
      if (user && token) {
        this.globalData.user = user;
        this.globalData.token = token;
      }
    } catch (e) {
      /* ignore */
    }
  },
});
