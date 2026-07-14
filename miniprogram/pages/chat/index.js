function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function demoReply(question) {
  const q = (question || '').trim();
  if (/python|排序|快速排序/i.test(q)) {
    return [
      '好的，这是一个简洁的 Python 快速排序示例：',
      '',
      'def quick_sort(arr):',
      '    if len(arr) <= 1:',
      '        return arr',
      '    pivot = arr[len(arr) // 2]',
      '    left = [x for x in arr if x < pivot]',
      '    mid = [x for x in arr if x == pivot]',
      '    right = [x for x in arr if x > pivot]',
      '    return quick_sort(left) + mid + quick_sort(right)',
      '',
      '需要我再解释每一步吗？',
    ].join('\n');
  }
  if (/react|hooks/i.test(q)) {
    return [
      'React Hooks 让函数组件也能用状态和副作用。',
      '',
      '常用：',
      '• useState：组件状态',
      '• useEffect：副作用 / 订阅',
      '• useRef：保存可变引用',
      '',
      '规则：只在组件顶层调用 Hooks。',
    ].join('\n');
  }
  if (/markdown|表格/i.test(q)) {
    return [
      'Markdown 表格示例：',
      '',
      '| 名称 | 作用 |',
      '| --- | --- |',
      '| 呆呆 AI | 对话助手 |',
      '| 呆呆网络 | 品牌入口 |',
    ].join('\n');
  }
  if (/斐波那契|fibonacci/i.test(q)) {
    return [
      '斐波那契数列实现：',
      '',
      'def fib(n):',
      '    a, b = 0, 1',
      '    for _ in range(n):',
      '        a, b = b, a + b',
      '    return a',
    ].join('\n');
  }
  return [
    `收到：${q.slice(0, 60) || '你好'}`,
    '',
    '我是呆呆 AI。现在是内置演示回复，小程序里已经可以直接聊。',
    '后续接上 DeepSeek Key 就能变成真实大模型。',
  ].join('\n');
}

Page({
  data: {
    statusBarHeight: 20,
    statusText: '随时为你解答',
    input: '',
    canSend: false,
    busy: false,
    scrollInto: '',
    messages: [
      {
        id: 'welcome',
        role: 'ai',
        content:
          '你好，我是呆呆 AI。\n\n可以问我编程、写作、学习问题。点下面的推荐，或直接输入。',
      },
    ],
    chips: [
      { id: '1', text: '写一个 Python 快速排序' },
      { id: '2', text: '解释 React Hooks' },
      { id: '3', text: '给我一个 Markdown 表格' },
      { id: '4', text: '实现斐波那契数列' },
    ],
  },

  _timer: null,

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  },

  onInput(e) {
    const input = e.detail.value || '';
    this.setData({ input, canSend: !!input.trim() && !this.data.busy });
  },

  onChip(e) {
    const text = e.currentTarget.dataset.text;
    if (!text || this.data.busy) return;
    this.setData({ input: text, canSend: true }, () => this.onSend());
  },

  onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.busy) return;

    const userMsg = { id: uid(), role: 'user', content: text };
    const aiId = uid();
    const messages = this.data.messages.concat([
      userMsg,
      { id: aiId, role: 'ai', content: '' },
    ]);

    this.setData({
      messages,
      input: '',
      canSend: false,
      busy: true,
      statusText: '正在思考…',
      scrollInto: 'm-bottom',
    });

    const full = demoReply(text);
    let i = 0;
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      i += 2;
      const content = full.slice(0, i);
      const next = this.data.messages.map((m) =>
        m.id === aiId ? { ...m, content } : m
      );
      const done = i >= full.length;
      this.setData({
        messages: next,
        scrollInto: 'm-bottom',
        ...(done
          ? { busy: false, statusText: '随时为你解答', canSend: false }
          : {}),
      });
      if (done) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }, 18);
  },
});
