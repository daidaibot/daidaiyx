App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用支持云开发的基础库（建议 2.2.3+）');
      return;
    }
    wx.cloud.init({
      // 在微信开发者工具顶部「云开发」开通后，把环境 ID 填到这里
      env: 'YOUR_CLOUDBASE_ENV_ID',
      traceUser: true,
    });
  },
  globalData: {
    brand: '呆呆网络',
  },
});
