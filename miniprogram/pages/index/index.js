Page({
  data: {
    statusBarHeight: 20,
    showSplash: true,
    splashLeaving: false,
    splashHide: false,
    splashDone: false,
    inAnim: false,
    scrollInto: '',
    year: 2026,
    cards: [
      { icon: '◈', title: 'AI 对话', desc: '随时问随时答，像豆包一样自然' },
      { icon: '◉', title: '多功能', desc: '一个入口，后续继续挂更多能力' },
      { icon: '◎', title: '持续更新', desc: '界面与功能会一点点做得更好' },
    ],
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      year: new Date().getFullYear(),
    });
  },

  enterSite() {
    if (this.data.splashLeaving || this.data.splashHide) return;
    this.setData({ splashLeaving: true });
    setTimeout(() => {
      this.setData({
        splashHide: true,
        showSplash: false,
        splashDone: true,
        inAnim: true,
      });
    }, 700);
  },

  scrollTo(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ scrollInto: id });
    setTimeout(() => this.setData({ scrollInto: '' }), 400);
  },

  goChat() {
    wx.navigateTo({ url: '/pages/chat/index' });
  },
});
