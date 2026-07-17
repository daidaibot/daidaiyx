const { getLayout } = require('../../utils/layout');

Page({
  data: {
    statusBarHeight: 20,
    heroPadTop: 100,
    isWide: false,
    showSplash: true,
    splashLeaving: false,
    splashHidden: false,
    pageReady: true,
    year: 2026,
    scrollInto: '',
    toastShow: false,
    aiOpening: false,
    aiPress: false,
    wechat: 'Aa_dai_520',
    qq: '25485733',
    cards: [
      { icon: '◈', title: '吃', text: '爱吃' },
      { icon: '◉', title: '睡', text: '爱睡' },
      { icon: '◎', title: '玩', text: '爱玩' },
    ],
  },

  _timer: null,
  _toastTimer: null,
  _opening: false,

  applyLayout() {
    const layout = getLayout();
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      heroPadTop: layout.heroPadTop,
      isWide: layout.isWide,
      year: new Date().getFullYear(),
    });
  },

  onLoad() {
    try {
      this.applyLayout();
    } catch (e) {
      console.warn('applyLayout failed', e);
      this.setData({ statusBarHeight: 20, heroPadTop: 92, pageReady: true });
    }
    this._onResize = () => {
      try {
        this.applyLayout();
      } catch (e) {
        /* ignore */
      }
    };
    if (wx.onWindowResize) wx.onWindowResize(this._onResize);
    // 开屏最多 1.6s，避免白屏卡住
    this._timer = setTimeout(() => this.enterSite(), 1600);
  },

  onShow() {
    this.applyLayout();
    // 从聊天页返回时清过渡层；导航进行中不要清，否则会打断打开
    if (this.data.aiOpening && !this._opening) {
      this.setData({ aiOpening: false, aiPress: false });
    }
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer);
    if (this._toastTimer) clearTimeout(this._toastTimer);
    if (this._onResize && wx.offWindowResize) wx.offWindowResize(this._onResize);
  },

  enterSite() {
    if (this.data.splashLeaving || this.data.splashHidden) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.setData({ splashLeaving: true, pageReady: true });
    setTimeout(() => {
      this.setData({ splashHidden: true, showSplash: false, splashLeaving: false });
    }, 750);
  },

  scrollTo(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ scrollInto: id });
    setTimeout(() => this.setData({ scrollInto: '' }), 500);
  },

  copyText(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({
      data: String(text),
      success: () => {
        this.setData({ toastShow: true });
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 1500);
      },
    });
  },

  goAi() {
    if (this._opening) return;
    this._opening = true;
    this.setData({ aiPress: true, aiOpening: true });

    const finish = (ok) => {
      this._opening = false;
      this.setData({ aiOpening: false, aiPress: false });
      if (!ok) {
        wx.showToast({ title: '无法打开呆呆 AI', icon: 'none' });
      }
    };

    // 不因状态接口卡住进不去；短过渡后直接进页
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages/chat/index',
        success: () => {
          // 等页面盖上后再收过渡层，避免闪一下首页
          setTimeout(() => finish(true), 260);
        },
        fail: () => {
          wx.redirectTo({
            url: '/pages/chat/index',
            success: () => finish(true),
            fail: () => finish(false),
          });
        },
      });
    }, 220);
  },
});
