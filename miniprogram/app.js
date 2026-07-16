App({
  globalData: {
    brand: '呆呆网络',
    product: '呆呆 AI',
    user: null,
    token: '',
    /**
     * 业务域名（不要末尾斜杠）
     * 需与 DAIDAI_API_BASE、小程序 request / downloadFile 合法域名一致
     */
    apiBase: 'https://dai.52xv.com',
  },
  onLaunch() {
    try {
      // 强制使用当前代码里的域名；清掉旧云托管域名缓存
      const fixed = 'https://dai.52xv.com';
      this.globalData.apiBase = fixed;
      wx.setStorageSync('daidai_api_base', fixed);
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
