const { getLayout } = require('../../utils/layout');
const { checkServiceReady } = require('../../utils/status');

Page({
  data: {
    statusBarHeight: 20,
    heroPadTop: 100,
    isWide: false,
    showSplash: true,
    splashLeaving: false,
    splashHidden: false,
    pageReady: false,
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
    this.applyLayout();
    this._onResize = () => this.applyLayout();
    if (wx.onWindowResize) wx.onWindowResize(this._onResize);
    this._timer = setTimeout(() => this.enterSite(), 3200);
  },

  onShow() {
    this.applyLayout();
    if (this.data.aiOpening) {
      this.setData({ aiOpening: false, aiPress: false });
      this._opening = false;
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
    checkServiceReady().then((st) => {
      if (!st.ok) return;
      this._opening = true;
      this.setData({ aiPress: true, aiOpening: true });

      setTimeout(() => {
        wx.navigateTo({
          url: '/pages/chat/index?enter=1',
          fail: () => {
            this.setData({ aiOpening: false, aiPress: false });
            this._opening = false;
          },
        });
      }, 420);
    });
  },
});
