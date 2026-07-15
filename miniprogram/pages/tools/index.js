Page({
  data: {
    statusBarHeight: 20,
    chatTools: [
      {
        id: 'chat',
        mode: 'chat',
        name: '自由对话',
        desc: '随便问，什么都可以聊',
        emoji: '💬',
        bg: 'rgba(64,145,108,0.12)',
      },
      {
        id: 'write',
        mode: 'write',
        name: '写作润色',
        desc: '改文案、扩写、礼貌表达',
        emoji: '✍️',
        bg: 'rgba(82,183,136,0.14)',
      },
      {
        id: 'translate',
        mode: 'translate',
        name: '翻译助手',
        desc: '中英互译，自然流畅',
        emoji: '🌐',
        bg: 'rgba(18,183,245,0.12)',
      },
      {
        id: 'code',
        mode: 'code',
        name: '代码助手',
        desc: '写代码、讲解、找 bug',
        emoji: '💻',
        bg: 'rgba(99,102,241,0.12)',
      },
      {
        id: 'summary',
        mode: 'summary',
        name: '总结提炼',
        desc: '长文变要点，会议记纪要',
        emoji: '📝',
        bg: 'rgba(245,158,11,0.12)',
      },
    ],
    imageTools: [
      {
        id: 'segment',
        name: '智能抠图',
        desc: '一键抠前景',
        icon: '/assets/aitools/segment.png',
      },
      {
        id: 'idphoto',
        name: 'AI 证件照',
        desc: '标准尺寸证件照',
        icon: '/assets/aitools/id-photo.png',
      },
      {
        id: 'hd',
        name: '图片清晰化',
        desc: '提升清晰度',
        icon: '/assets/aitools/hd.png',
      },
      {
        id: 'colorize',
        name: '照片上色',
        desc: '黑白变彩色',
        icon: '/assets/aitools/colorize.png',
      },
      {
        id: 'watermark',
        name: '去水印',
        desc: '图片水印清理',
        icon: '/assets/aitools/delete_remark.png',
      },
      {
        id: 'music',
        name: 'AI 音乐',
        desc: '生成短旋律灵感',
        icon: '/assets/aitools/music-generator.png',
      },
    ],
    moreTools: [
      {
        id: 'name',
        mode: 'name',
        name: '宝宝取名',
        desc: '寓意好名，多风格候选',
        emoji: '👶',
        bg: 'rgba(236,72,153,0.12)',
      },
      {
        id: 'pdf',
        mode: '',
        demo: true,
        name: 'PDF 去水印',
        desc: '清理 PDF 水印（即将开放）',
        emoji: '📄',
        bg: 'rgba(100,116,139,0.12)',
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

  openChat(e) {
    const mode = e.currentTarget.dataset.mode || 'chat';
    wx.navigateTo({ url: `/pages/chat/index?mode=${mode}` });
  },

  openImageTool(e) {
    const name = e.currentTarget.dataset.name || '该功能';
    wx.showModal({
      title: name,
      content: '图像能力即将接入。现阶段可先用「智能对话」完成文字类需求。',
      confirmText: '去对话',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/chat/index?mode=chat' });
        }
      },
    });
  },

  openMore(e) {
    const { mode, demo, name } = e.currentTarget.dataset;
    if (demo || !mode) {
      wx.showToast({ title: `${name || '功能'}即将开放`, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/chat/index?mode=${mode}` });
  },
});
