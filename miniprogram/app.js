App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用支持云开发的基础库');
      return;
    }
    wx.cloud.init({
      // 云开发开通后换成真实环境 ID
      env: 'YOUR_CLOUDBASE_ENV_ID',
      traceUser: true,
    });
  },
  globalData: {
    brand: '呆呆网络',
    // 云开发 AI：优先 cloudbase 聚合模型；也可改 deepseek
    aiProvider: 'deepseek',
    aiModel: 'deepseek-v3',
  },
});
