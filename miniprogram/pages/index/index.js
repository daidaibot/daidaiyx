Page({
  data: {
    statusBarHeight: 20,
    heroPadTop: 76,
    showSplash: true,
    splashLeaving: false,
    year: 2026,
    scrollInto: '',
    cards: [
      { icon: '◈', title: 'AI 对话', desc: '随时问随时答，像豆包一样自然' },
      { icon: '◉', title: '多功能', desc: '一个入口，后续继续挂更多能力' },
      { icon: '◎', title: '持续更新', desc: '界面与功能会一点点做得更好' },
    ],
  },

  _timer: null,

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const statusBarHeight = info.statusBarHeight || 20;
    this.setData({
      statusBarHeight,
      heroPadTop: statusBarHeight + 56,
      year: new Date().getFullYear(),
    });
    // 2 秒后自动进入，避免一直停在开场
    this._timer = setTimeout(() => this.enterSite(), 2000);
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer);
  },

  enterSite() {
    if (this.data.splashLeaving || !this.data.showSplash) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.setData({ splashLeaving: true });
    setTimeout(() => {
      this.setData({ showSplash: false, splashLeaving: false });
    }, 480);
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
