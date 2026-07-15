App({
  globalData: {
    brand: '呆呆网络',
    product: '呆呆 AI',
    user: null,
    token: '',
    /**
     * 云托管公网域名（不要末尾斜杠）
     * 需与 DAIDAI_API_BASE、小程序 request 合法域名一致
     */
    apiBase: 'https://daidai12-282126-9-1453974162.sh.run.tcloudbase.com',
  },
  onLaunch() {
    try {
      const savedBase = wx.getStorageSync('daidai_api_base');
      if (savedBase && !this.globalData.apiBase) {
        this.globalData.apiBase = String(savedBase).replace(/\/$/, '');
      }
      const user = wx.getStorageSync('daidai_user');
      const token = wx.getStorageSync('daidai_token');
      if (user && token) {
        this.globalData.user = user;
        this.globalData.token = token;
      }
    } catch (e) {
      /* ignore */
    }

    const base = (this.globalData.apiBase || '').replace(/\/$/, '');
    if (base) {
      wx.request({
        url: `${base}/api/public/status`,
        method: 'GET',
        timeout: 8000,
        success: (res) => {
          const data = res.data || {};
          if (data.ok && data.apiBase && !this.globalData.apiBase) {
            this.globalData.apiBase = String(data.apiBase).replace(/\/$/, '');
          }
        },
      });
    }
  },
});
