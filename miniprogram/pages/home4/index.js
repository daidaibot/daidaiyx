Page({
  data: {
    statusBarHeight: 20,
    tools: [
      {
        name: 'AI音乐生成',
        description: '创作独特的音乐旋律',
        icon: '/assets/aitools/music-generator.png',
      },
      {
        name: '图片去水印',
        description: '一键去除图片水印',
        icon: '/assets/aitools/delete_remark.png',
      },
      {
        name: '图片清晰化',
        description: '一键提升图片清晰度',
        icon: '/assets/aitools/hd.png',
      },
      {
        name: 'AI证件照',
        description: '智能生成标准证件照，支持各种尺寸',
        icon: '/assets/aitools/id-photo.png',
      },
      {
        name: '照片上色',
        description: 'AI让黑白照片重获生机',
        icon: '/assets/aitools/colorize.png',
      },
      {
        name: '智能抠图',
        description: 'AI智能识别前景，一键抠图',
        icon: '/assets/aitools/segment.png',
      },
      {
        name: 'AI宝宝取名',
        description: '为宝宝创造有寓意的好名字',
        icon: '/assets/aitools/name-generator.png',
      },
      {
        name: 'PDF去水印',
        description: '一键去除PDF水印',
        icon: '/assets/aitools/pdf-watermark.png',
      },
    ],
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  onTool(e) {
    const name = e.currentTarget.dataset.name;
    wx.showToast({ title: name + '（演示入口）', icon: 'none' });
  },

  goChat() {
    wx.navigateTo({ url: '/pages/chat/index' });
  },

  goHome2() {
    wx.redirectTo({ url: '/pages/home2/index' });
  },
});
