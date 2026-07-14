function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const SYSTEM_PROMPT =
  '你是「呆呆网络」的智能助手。回答简洁、清晰、有帮助，语气专业但友好。必要时用分点说明。';

Page({
  data: {
    statusBarHeight: 20,
    input: '',
    loading: false,
    started: false,
    scrollInto: '',
    messages: [],
    suggestions: [
      '帮我写一段呆呆网络产品介绍',
      '用三句话说清什么是小程序云开发',
      '给我一套 AI 助手的运营冷启动建议',
    ],
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  onClear() {
    if (this.data.loading) return;
    this.setData({ messages: [], started: false, scrollInto: '' });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onChip(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({ input: text }, () => this.onSend());
  },

  async onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.loading) return;

    const userMsg = { id: uid(), role: 'user', content: text };
    const botId = uid();
    const botMsg = { id: botId, role: 'assistant', content: '', streaming: true };
    const messages = this.data.messages.concat(userMsg, botMsg);

    this.setData({
      input: '',
      loading: true,
      started: true,
      messages,
      scrollInto: `m${botId}`,
    });

    const history = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .filter((m) => m.id !== botId)
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      await this.streamReply(botId, history);
    } catch (err) {
      const tip =
        err && (err.errMsg || err.message)
          ? String(err.errMsg || err.message)
          : '调用失败';
      const hint =
        tip.indexOf('env') >= 0 || tip.indexOf('CLOUDBASE') >= 0 || tip.indexOf('cloud') >= 0
          ? `${tip}\n\n请检查：1) app.js 环境 ID  2) 云开发已开通 AI/DeepSeek`
          : tip;
      this.patchBot(botId, hint, false);
    } finally {
      this.setData({ loading: false });
    }
  },

  patchBot(botId, content, streaming) {
    const messages = this.data.messages.map((m) =>
      m.id === botId ? { ...m, content, streaming: !!streaming } : m
    );
    this.setData({ messages, scrollInto: `m${botId}` });
  },

  async streamReply(botId, history) {
    if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
      throw new Error('当前基础库不支持云开发 AI，请把调试基础库调到 3.7.1 以上');
    }

    const app = getApp();
    const provider = (app.globalData && app.globalData.aiProvider) || 'deepseek';
    const modelName = (app.globalData && app.globalData.aiModel) || 'deepseek-v3';
    const model = wx.cloud.extend.AI.createModel(provider);

    const res = await model.streamText({
      data: {
        model: modelName,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      },
    });

    let buffer = '';
    let lastFlush = 0;
    for await (const chunk of res.textStream) {
      buffer += chunk;
      const now = Date.now();
      if (now - lastFlush > 80) {
        this.patchBot(botId, buffer, true);
        lastFlush = now;
      }
    }
    this.patchBot(botId, buffer || '（没有返回内容）', false);
  },
});
