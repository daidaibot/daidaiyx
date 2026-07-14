function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

Page({
  data: {
    input: '',
    loading: false,
    scrollInto: '',
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        content: '你好，我是呆呆网络助手。有什么我可以帮你的？',
      },
    ],
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.loading) return;

    const apiBase = (getApp().globalData.apiBase || '').replace(/\/$/, '');
    if (!apiBase) {
      wx.showModal({
        title: '还没配置云托管地址',
        content:
          '请打开 miniprogram/app.js，把 globalData.apiBase 改成你的微信云托管公网域名。',
        showCancel: false,
      });
      return;
    }

    const userMsg = { id: uid(), role: 'user', content: text };
    const next = this.data.messages.concat(userMsg);
    this.setData({
      input: '',
      loading: true,
      messages: next,
      scrollInto: `m${userMsg.id}`,
    });

    try {
      const history = next
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: `${apiBase}/api/chat`,
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: {
            messages: [
              {
                role: 'system',
                content: '你是「呆呆网络」的智能助手，回答简洁有用。',
              },
              ...history,
            ],
          },
          success: resolve,
          fail: reject,
        });
      });

      const reply =
        (res.data && (res.data.reply || res.data.error)) ||
        `请求失败 (${res.statusCode || 'network'})`;
      const botMsg = {
        id: uid(),
        role: 'assistant',
        content: String(reply),
      };
      const messages = this.data.messages.concat(botMsg);
      this.setData({ messages, scrollInto: `m${botMsg.id}` });
    } catch (err) {
      const botMsg = {
        id: uid(),
        role: 'assistant',
        content: `网络异常：${err.errMsg || err.message || err}`,
      };
      this.setData({
        messages: this.data.messages.concat(botMsg),
        scrollInto: `m${botMsg.id}`,
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
