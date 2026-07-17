const HEARTBEAT_MS = 4 * 60 * 1000; // 前台每 4 分钟心跳一次，保持云托管实例热启

App({
  globalData: {
    brand: '呆呆网络',
    product: '呆呆 AI',
    user: null,
    token: '',
    online: true,
    /**
     * 业务域名（不要末尾斜杠）
     * 需与 DAIDAI_API_BASE、小程序 request / downloadFile 合法域名一致
     */
    apiBase: 'https://dai.52xv.com',
  },

  _heartbeatTimer: null,

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

    // 监听网络变化，恢复联网时立刻预热一次
    if (typeof wx.onNetworkStatusChange === 'function') {
      wx.onNetworkStatusChange((res) => {
        this.globalData.online = !!res.isConnected;
        if (res.isConnected) this.warmUp();
      });
    }

    this.warmUp();
  },

  onShow() {
    // 每次回到前台立刻预热，并启动心跳，避免长时间无请求导致实例休眠 / 掉线
    this.warmUp();
    this.startHeartbeat();
  },

  onHide() {
    this.stopHeartbeat();
  },

  /** 轻量预热：ping 一次公开状态，带一次重试，唤醒云托管实例 */
  warmUp(retry = 1) {
    const base = (this.globalData.apiBase || '').replace(/\/$/, '');
    if (!base) return;
    wx.request({
      url: `${base}/api/public/status`,
      method: 'GET',
      timeout: 8000,
      success: (res) => {
        this.globalData.online = true;
        const data = res.data || {};
        if (data.ok && data.apiBase) {
          this.globalData.apiBase = String(data.apiBase).replace(/\/$/, '');
        }
      },
      fail: () => {
        // 冷启动 / 实例休眠时第一枪常超时，稍后再补一枪把它唤醒
        if (retry > 0) {
          setTimeout(() => this.warmUp(retry - 1), 1500);
        } else {
          this.globalData.online = false;
        }
      },
    });
  },

  startHeartbeat() {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(() => this.warmUp(0), HEARTBEAT_MS);
  },

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },
});
