const {
  BUILTIN_MASKS,
  EMOJI_PRESETS,
  allMasks,
  findMask,
  loadCustomMasks,
  createCustomMask,
  deleteCustomMask,
} = require('../../utils/masks');
const {
  getUser,
  isLoggedIn,
  loginWithWeChat,
  clearSession,
} = require('../../utils/auth');
const {
  loadHistory,
  saveSession,
  getSession,
  removeSession,
  clearHistory,
} = require('../../utils/history');
const { getLayout } = require('../../utils/layout');

const SKILLS = [
  {
    id: 'image',
    name: '生图',
    desc: '一句话画出画面',
    emoji: '🎨',
    bg: 'rgba(168,85,247,0.12)',
    placeholder: '描述你想生成的图片…',
  },
  {
    id: 'edit',
    name: '改图',
    desc: '上传图片再说怎么改',
    emoji: '🖌️',
    bg: 'rgba(236,72,153,0.12)',
    placeholder: '先上传图片，再说怎么改…',
  },
  {
    id: 'write',
    name: '帮我写作',
    desc: '文案、润色、扩写',
    emoji: '✍️',
    bg: 'rgba(59,130,246,0.12)',
    placeholder: '想写什么？或贴上原文让我改…',
  },
  {
    id: 'translate',
    name: '翻译',
    desc: '中英互译更自然',
    emoji: '🌐',
    bg: 'rgba(16,185,129,0.12)',
    placeholder: '输入要翻译的内容…',
  },
  {
    id: 'code',
    name: '编程',
    desc: '写代码、讲思路',
    emoji: '💻',
    bg: 'rgba(245,158,11,0.12)',
    placeholder: '描述编程问题或贴代码…',
  },
  {
    id: 'summary',
    name: '总结',
    desc: '长文变要点',
    emoji: '📝',
    bg: 'rgba(14,165,233,0.12)',
    placeholder: '粘贴要总结的内容…',
  },
];

function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function skillById(id) {
  return SKILLS.find((s) => s.id === id);
}

function systemPrompt(skill, mask) {
  const brand =
    '你是「呆呆 AI」，由呆呆网络提供。对外只称呼自己为呆呆 AI，不要提及任何底层模型、厂商或 API 名称。';
  if (mask && mask.prompt) {
    return `${brand}\n当前角色面具要求：\n${mask.prompt}`;
  }
  if (skill === 'write') {
    return `${brand}\n你擅长写作、文案与润色，输出可直接使用。`;
  }
  if (skill === 'translate') {
    return `${brand}\n你擅长中英互译，译文自然流畅。`;
  }
  if (skill === 'code') {
    return `${brand}\n你擅长编程：给出可运行代码，并简要说明思路与注意点。`;
  }
  if (skill === 'summary') {
    return `${brand}\n你擅长总结提炼：条理清晰的要点与行动项。`;
  }
  if (skill === 'idea') {
    return `${brand}\n你擅长头脑风暴：给出多样可行的点子并简短解释。`;
  }
  return `${brand}\n请简洁友好、乐于助人。`;
}

function friendlyError(msg) {
  const s = String(msg || '');
  if (
    /api.?key|OPENAI|DeepSeek|deepseek|gpt-?image|openai|dall-?e|unauthorized|401|403|503|未配置/i.test(
      s
    )
  ) {
    return '呆呆 AI 暂时不可用，请稍后再试';
  }
  if (/timeout|超时|fail|network|ERR_/i.test(s)) {
    return '网络不太稳定，请稍后再试';
  }
  if (!s) return '呆呆 AI 处理失败，请稍后再试';
  // 去掉可能泄露的英文厂商词
  return s
    .replace(/DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|DALL·E|Claude/gi, '呆呆 AI')
    .slice(0, 120);
}

function demoTextReply(question, skill, mask) {
  const q = (question || '').trim();
  if (mask) {
    return `【${mask.name}】你好，我是呆呆 AI。\n\n收到：${q.slice(0, 60)}\n\n配置服务后，我会按这个面具和你聊。`;
  }
  if (skill === 'translate' || /翻译|translate/i.test(q)) {
    return `呆呆 AI 翻译参考：\n\n${q.replace(/^翻译[:：]?\s*/i, '').slice(0, 120)}\n\n（本地预览；连上服务后就是完整翻译）`;
  }
  if (skill === 'write' || /写作|润色|文案/i.test(q)) {
    return '好的，这是呆呆 AI 帮你起的一版文案草稿（本地预览）。连上服务后会按你的语气完整重写。';
  }
  if (skill === 'summary') {
    return '呆呆 AI 三点摘要：\n1. 重点已对齐\n2. 风险需确认\n3. 下一步给出方案';
  }
  if (skill === 'idea') {
    return '呆呆 AI 三个方向：\n1. 做最小可体验版\n2. 先验证一个核心需求\n3. 用内容冷启动拉反馈';
  }
  if (skill === 'code' || /代码|python|排序/i.test(q)) {
    return [
      '好的，这是呆呆 AI 写的快速排序示例：',
      '',
      'def quick_sort(arr):',
      '    if len(arr) <= 1: return arr',
      '    p = arr[len(arr)//2]',
      '    return quick_sort([x for x in arr if x < p]) + [x for x in arr if x == p] + quick_sort([x for x in arr if x > p])',
    ].join('\n');
  }
  return `收到：${q.slice(0, 80)}\n\n我是呆呆 AI。可以聊天、写作、编程、翻译，也可以生图和改图。`;
}

function demoImagePath() {
  return '/assets/aitools/colorize.png';
}

function emptyForm() {
  return { name: '', emoji: '🎭', desc: '', prompt: '', hello: '' };
}

Page({
  data: {
    statusBarHeight: 20,
    isWide: false,
    isPc: false,
    skills: SKILLS,
    builtinMasks: BUILTIN_MASKS,
    customMasks: [],
    maskPreview: [],
    emojiPresets: EMOJI_PRESETS,
    activeSkill: '',
    skillLabel: '',
    activeMask: '',
    maskLabel: '',
    maskPrompt: '',
    navTitle: '呆呆 AI',
    navSub: '随时帮忙',
    welcomeEmoji: '呆',
    welcomeHi: '有什么可以帮忙的？',
    welcomeSub: '游客可逛 · 使用功能需登录',
    placeholder: '有问题，尽管问',
    input: '',
    canSend: false,
    busy: false,
    showSheet: false,
    showMaskPanel: false,
    showMaskCreate: false,
    showLogin: false,
    form: emptyForm(),
    scrollInto: '',
    messages: [],
    imageSize: '1024x1024',
    editImagePath: '',
    editImageB64: '',
    editMime: 'image/jpeg',
    entered: false,
    loggedIn: false,
    loginLoading: false,
    loginNick: '',
    loginAvatar: '',
    user: { nickName: '微信用户', avatarUrl: '' },
    showDrawer: false,
    historyList: [],
    sessionId: '',
    sizes: [
      { label: '1:1', value: '1024x1024' },
      { label: '3:2', value: '1536x1024' },
      { label: '2:3', value: '1024x1536' },
    ],
  },

  _timer: null,

  applyLayout() {
    const layout = getLayout();
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      isWide: layout.isWide,
      isPc: layout.isPc,
    });
  },

  onLoad() {
    this.applyLayout();
    this._onResize = () => this.applyLayout();
    if (wx.onWindowResize) wx.onWindowResize(this._onResize);
    this.refreshAuth();
    this.refreshMasks();
    this.refreshHistory();
    // 登录用户进入时恢复最近一次对话（豆包体验）
    if (isLoggedIn()) {
      this.restoreLatestSession();
    }
    setTimeout(() => this.setData({ entered: true }), 30);
  },

  onUnload() {
    if (this._onResize && wx.offWindowResize) wx.offWindowResize(this._onResize);
    this.saveCurrentSession();
    if (this._timer) clearInterval(this._timer);
  },

  onShow() {
    this.applyLayout();
    this.refreshAuth();
    this.refreshHistory();
  },

  onHide() {
    this.saveCurrentSession();
  },

  refreshAuth() {
    const loggedIn = isLoggedIn();
    const user = getUser() || { nickName: '微信用户', avatarUrl: '' };
    const patch = {
      loggedIn,
      user,
      loginNick: user.nickName || this.data.loginNick || '',
      loginAvatar: user.avatarUrl || this.data.loginAvatar || '',
    };
    if (!loggedIn) {
      patch.navSub = '游客模式';
      if (!this.data.messages || this.data.messages.length === 0) {
        patch.welcomeSub = '游客可逛 · 使用功能需登录';
      }
    } else if (this.data.navSub === '游客模式') {
      patch.navSub = '随时帮忙';
      if (
        !this.data.messages ||
        this.data.messages.length === 0 ||
        (this.data.welcomeSub || '').indexOf('游客') !== -1
      ) {
        patch.welcomeSub = '我是呆呆 AI · 聊天写作编程 · 生图改图';
      }
    }
    this.setData(patch);
  },

  refreshHistory() {
    this.setData({ historyList: loadHistory() });
  },

  restoreLatestSession() {
    const list = loadHistory();
    if (!list.length) return;
    this.openSessionById(list[0].id, { silent: true });
  },

  openSessionById(id, opts = {}) {
    if (!id) return false;
    const sess = getSession(id);
    if (!sess || !sess.messages || !sess.messages.length) {
      if (!opts.silent) {
        wx.showToast({ title: '这条记录已失效', icon: 'none' });
        this.refreshHistory();
      }
      return false;
    }
    const meta = sess.meta || {};
    this.setData(
      {
        sessionId: sess.id,
        messages: sess.messages.map((m) => ({ ...m, loading: false })),
        activeSkill: meta.activeSkill || '',
        skillLabel: meta.skillLabel || '',
        activeMask: meta.activeMask || '',
        maskLabel: meta.maskLabel || '',
        maskPrompt: meta.maskPrompt || '',
        welcomeEmoji: meta.welcomeEmoji || '呆',
        navTitle: '呆呆 AI',
        navSub: meta.activeMask
          ? meta.navSub || `面具 · ${meta.maskLabel || ''}`
          : '随时帮忙',
        imageSize: meta.imageSize || '1024x1024',
        showDrawer: false,
        input: '',
        canSend: false,
        busy: false,
        placeholder: meta.activeSkill
          ? skillById(meta.activeSkill)?.placeholder || '有问题，尽管问'
          : meta.activeMask
            ? `以「${meta.maskLabel || '面具'}」继续说…`
            : '有问题，尽管问',
        scrollInto: '',
      },
      () => {
        setTimeout(() => this.setData({ scrollInto: 'm-bottom' }), 80);
      }
    );
    if (!opts.silent) {
      wx.showToast({ title: '已进入对话', icon: 'none' });
    }
    return true;
  },

  saveCurrentSession() {
    if (!this.data.loggedIn && !isLoggedIn()) return;
    const messages = (this.data.messages || []).filter(
      (m) => m && !m.loading && (m.content || m.image)
    );
    if (!messages.length) return;

    let sessionId = this.data.sessionId;
    if (!sessionId) {
      sessionId = `s_${Date.now()}`;
      this.setData({ sessionId });
    }

    const list = saveSession({
      id: sessionId,
      messages,
      meta: {
        activeSkill: this.data.activeSkill,
        skillLabel: this.data.skillLabel,
        activeMask: this.data.activeMask,
        maskLabel: this.data.maskLabel,
        maskPrompt: this.data.maskPrompt,
        welcomeEmoji: this.data.welcomeEmoji,
        navSub: this.data.navSub,
        imageSize: this.data.imageSize,
      },
    });
    this.setData({ historyList: list });
  },

  refreshMasks() {
    const customMasks = loadCustomMasks();
    const maskPreview = allMasks().slice(0, 10);
    this.setData({ customMasks, maskPreview });
  },

  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (url) this.setData({ loginAvatar: url });
  },

  onNickInput(e) {
    this.setData({ loginNick: (e.detail && e.detail.value) || '' });
  },

  openLogin() {
    this.setData({
      showLogin: true,
      showDrawer: false,
      showSheet: false,
      showMaskPanel: false,
      showMaskCreate: false,
    });
  },

  closeLogin() {
    this.setData({ showLogin: false });
  },

  /** 游客可浏览；真正使用时再拦 */
  ensureLogin() {
    if (this.data.loggedIn || isLoggedIn()) {
      if (!this.data.loggedIn) this.refreshAuth();
      return true;
    }
    this.openLogin();
    return false;
  },

  onLogin() {
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    loginWithWeChat({
      nickName: this.data.loginNick,
      avatarUrl: this.data.loginAvatar,
    })
      .then((user) => {
        this.setData({
          loggedIn: true,
          user,
          loginLoading: false,
          showLogin: false,
          showDrawer: false,
          welcomeSub: '我是呆呆 AI · 聊天写作编程 · 生图改图',
          navSub: '随时帮忙',
        });
        this.refreshHistory();
        if (!this.data.messages.length) {
          this.restoreLatestSession();
        }
        wx.showToast({ title: '登录成功', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ loginLoading: false });
        wx.showToast({
          title: (err && err.message) || '登录失败',
          icon: 'none',
        });
      });
  },

  onLogout() {
    this.saveCurrentSession();
    clearSession();
    this.setData({
      loggedIn: false,
      user: { nickName: '微信用户', avatarUrl: '' },
      showDrawer: false,
      showLogin: false,
      messages: [],
      sessionId: '',
      welcomeSub: '游客可逛 · 使用功能需登录',
      navSub: '游客模式',
    });
    this.refreshHistory();
    wx.showToast({ title: '已退出，仍可浏览', icon: 'none' });
  },

  openDrawer() {
    this.refreshHistory();
    this.setData({
      showDrawer: true,
      showSheet: false,
      showMaskPanel: false,
      showMaskCreate: false,
    });
  },

  closeDrawer() {
    this.setData({ showDrawer: false });
  },

  goHome() {
    this.setData({ showDrawer: false });
    wx.reLaunch({ url: '/pages/index/index' });
  },

  goBack() {
    this.goHome();
  },

  onNewChatFromDrawer() {
    this.setData({ showDrawer: false });
    this.onNewChat();
  },

  onPickHistory(e) {
    if (!this.ensureLogin()) return;
    const id = e.currentTarget.dataset.id;
    this.openSessionById(id);
  },

  onDeleteHistory(e) {
    if (!this.ensureLogin()) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删除对话',
      content: '删除后无法恢复，确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        const list = removeSession(id);
        const patch = { historyList: list };
        if (this.data.sessionId === id) {
          Object.assign(patch, {
            sessionId: '',
            messages: [],
            activeSkill: '',
            skillLabel: '',
            activeMask: '',
            maskLabel: '',
            maskPrompt: '',
            welcomeEmoji: '呆',
            welcomeHi: '有什么可以帮忙的？',
            welcomeSub: '我是呆呆 AI · 聊天写作编程 · 生图改图',
            navSub: '随时帮忙',
            placeholder: '有问题，尽管问',
          });
        }
        this.setData(patch);
        wx.showToast({ title: '已删除', icon: 'none' });
      },
    });
  },

  onNewChat() {
    if (this._timer) clearInterval(this._timer);
    this.saveCurrentSession();
    this.setData({
      messages: [],
      input: '',
      canSend: false,
      busy: false,
      activeSkill: '',
      skillLabel: '',
      activeMask: '',
      maskLabel: '',
      maskPrompt: '',
      navTitle: '呆呆 AI',
      navSub: this.data.loggedIn ? '随时帮忙' : '游客模式',
      welcomeEmoji: '呆',
      welcomeHi: '有什么可以帮忙的？',
      welcomeSub: this.data.loggedIn
        ? '我是呆呆 AI · 聊天写作编程 · 生图改图'
        : '游客可逛 · 使用功能需登录',
      placeholder: '有问题，尽管问',
      showSheet: false,
      showMaskPanel: false,
      showMaskCreate: false,
      showDrawer: false,
      showLogin: false,
      editImagePath: '',
      editImageB64: '',
      editMime: 'image/jpeg',
      sessionId: '',
      scrollInto: '',
    });
    this.refreshHistory();
  },

  onInput(e) {
    const input = e.detail.value || '';
    this.setData({ input, canSend: this.computeCanSend(input) });
  },

  computeCanSend(input) {
    const text = (input !== undefined ? input : this.data.input || '').trim();
    if (this.data.busy) return false;
    if (this.data.activeSkill === 'edit') {
      return !!text && !!this.data.editImagePath;
    }
    return !!text;
  },

  onPlus() {
    this.setData({ showSheet: true, showMaskPanel: false, showMaskCreate: false });
  },

  closeSheet() {
    this.setData({ showSheet: false });
  },

  openMaskPanel() {
    this.refreshMasks();
    this.setData({
      showSheet: false,
      showMaskCreate: false,
      showMaskPanel: true,
    });
  },

  closeMaskPanel() {
    this.setData({ showMaskPanel: false });
  },

  openMaskCreate() {
    this.setData({
      showSheet: false,
      showMaskPanel: false,
      showMaskCreate: true,
      form: emptyForm(),
    });
  },

  closeMaskCreate() {
    this.setData({ showMaskCreate: false });
  },

  onPickEmoji(e) {
    this.setData({ 'form.emoji': e.currentTarget.dataset.emoji });
  },

  onFormName(e) {
    this.setData({ 'form.name': e.detail.value });
  },

  onFormDesc(e) {
    this.setData({ 'form.desc': e.detail.value });
  },

  onFormPrompt(e) {
    this.setData({ 'form.prompt': e.detail.value });
  },

  onFormHello(e) {
    this.setData({ 'form.hello': e.detail.value });
  },

  onSaveMask() {
    if (!this.ensureLogin()) return;
    const { name, prompt } = this.data.form;
    if (!String(name || '').trim()) {
      wx.showToast({ title: '请填写名称', icon: 'none' });
      return;
    }
    if (!String(prompt || '').trim()) {
      wx.showToast({ title: '请填写人设提示词', icon: 'none' });
      return;
    }
    const mask = createCustomMask(this.data.form);
    this.refreshMasks();
    this.setData({ showMaskCreate: false });
    this.applyMask(mask);
    wx.showToast({ title: '已创建并戴上', icon: 'success' });
  },

  onDeleteMask(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除面具',
      content: '删除后不可恢复，确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        deleteCustomMask(id);
        const patch = { };
        if (this.data.activeMask === id) {
          Object.assign(patch, {
            activeMask: '',
            maskLabel: '',
            maskPrompt: '',
            navTitle: '呆呆 AI',
            navSub: '随时帮忙',
            welcomeEmoji: '呆',
            welcomeHi: '有什么可以帮忙的？',
            welcomeSub: '我是呆呆 AI · 聊天写作编程 · 生图改图',
          });
        }
        this.refreshMasks();
        if (Object.keys(patch).length) this.setData(patch);
        wx.showToast({ title: '已删除', icon: 'none' });
      },
    });
  },

  setSkill(id) {
    const skill = skillById(id);
    if (!skill) {
      this.setData({
        activeSkill: '',
        skillLabel: '',
        editImagePath: '',
        editImageB64: '',
        placeholder: this.data.activeMask
          ? `以「${this.data.maskLabel}」继续说…`
          : '有问题，尽管问',
        showSheet: false,
        canSend: this.computeCanSend(this.data.input),
      });
      return;
    }
    this.setData(
      {
        activeSkill: id,
        skillLabel: skill.name,
        placeholder: skill.placeholder,
        showSheet: false,
        ...(id !== 'edit'
          ? { editImagePath: '', editImageB64: '' }
          : {}),
      },
      () => {
        this.setData({ canSend: this.computeCanSend(this.data.input) });
      }
    );
  },

  onSkill(e) {
    this.setSkill(e.currentTarget.dataset.id);
  },

  onSkillFromSheet(e) {
    this.setSkill(e.currentTarget.dataset.id);
  },

  clearSkill() {
    this.setSkill('');
  },

  applyMask(mask) {
    if (!mask) return;
    if (!this.ensureLogin()) return;
    const hello = mask.hello || `你好，我是${mask.name}。`;
    this.setData(
      {
      activeMask: mask.id,
      maskLabel: `${mask.emoji} ${mask.name}`,
      maskPrompt: mask.prompt,
      navTitle: '呆呆 AI',
      navSub: `面具 · ${mask.name}`,
      welcomeEmoji: mask.emoji,
      welcomeHi: mask.name,
      welcomeSub: `呆呆 AI · ${mask.desc}`,
      placeholder: `以「${mask.name}」继续说…`,
      showMaskPanel: false,
      showMaskCreate: false,
      showSheet: false,
      sessionId: `s_${Date.now()}`,
      messages: [
        {
          id: uid(),
          role: 'ai',
          content: hello,
        },
      ],
      scrollInto: 'm-bottom',
      },
      () => this.saveCurrentSession()
    );
  },

  onPickMask(e) {
    const mask = findMask(e.currentTarget.dataset.id);
    if (!mask) return;
    this.applyMask(mask);
  },

  clearMask() {
    this.setData({
      activeMask: '',
      maskLabel: '',
      maskPrompt: '',
      navTitle: '呆呆 AI',
      navSub: '随时帮忙',
      welcomeEmoji: '呆',
      welcomeHi: '有什么可以帮忙的？',
      welcomeSub: '我是呆呆 AI · 聊天写作编程 · 生图改图',
      placeholder: this.data.activeSkill
        ? skillById(this.data.activeSkill)?.placeholder || '有问题，尽管问'
        : '有问题，尽管问',
    });
  },

  onSize(e) {
    this.setData({ imageSize: e.currentTarget.dataset.value });
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  onSend() {
    if (!this.ensureLogin()) return;
    const text = (this.data.input || '').trim();
    if (!text || this.data.busy) return;
    if (this.data.activeSkill === 'image') {
      this.sendImage(text);
    } else if (this.data.activeSkill === 'edit') {
      this.sendImageEdit(text);
    } else {
      this.sendText(text);
    }
  },

  pickEditImage() {
    if (!this.ensureLogin()) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || {};
        const path = file.tempFilePath;
        if (!path) return;
        if (file.size && file.size > 8 * 1024 * 1024) {
          wx.showToast({ title: '图片请小于 8MB', icon: 'none' });
          return;
        }
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path,
          encoding: 'base64',
          success: (r) => {
            const lower = path.toLowerCase();
            const mime = lower.endsWith('.png')
              ? 'image/png'
              : lower.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
            this.setData(
              {
                activeSkill: 'edit',
                skillLabel: '改图',
                placeholder: '说说怎么改这张图…',
                editImagePath: path,
                editImageB64: r.data,
                editMime: mime,
                showSheet: false,
              },
              () => this.setData({ canSend: this.computeCanSend(this.data.input) })
            );
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
        });
      },
    });
  },

  clearEditImage() {
    this.setData(
      { editImagePath: '', editImageB64: '' },
      () => this.setData({ canSend: this.computeCanSend(this.data.input) })
    );
  },

  pushMessages(list, extra = {}) {
    this.setData({
      messages: this.data.messages.concat(list),
      scrollInto: 'm-bottom',
      ...extra,
    });
  },

  updateMessage(id, patch) {
    const messages = this.data.messages.map((m) =>
      m.id === id ? { ...m, ...patch } : m
    );
    this.setData({ messages, scrollInto: 'm-bottom' });
  },

  sendText(text) {
    const skill = this.data.activeSkill;
    const mask = findMask(this.data.activeMask);
    const history = this.data.messages
      .filter((m) => m.content && !m.loading)
      .slice(-12)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));

    const userMsg = { id: uid(), role: 'user', content: text };
    const aiId = uid();
    this.pushMessages(
      [userMsg, { id: aiId, role: 'ai', content: '', loading: true }],
      {
        input: '',
        canSend: false,
        busy: true,
      }
    );

    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';

    if (apiBase) {
      wx.request({
        url: `${apiBase.replace(/\/$/, '')}/api/chat`,
        method: 'POST',
        timeout: 120000,
        data: {
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt(skill, mask) },
            ...history,
            { role: 'user', content: text },
          ],
        },
        success: (res) => {
          const content =
            res.data?.choices?.[0]?.message?.content ||
            (res.data?.error?.message
              ? friendlyError(res.data.error.message)
              : demoTextReply(text, skill, mask));
          this.typeOut(aiId, content);
        },
        fail: () => this.typeOut(aiId, demoTextReply(text, skill, mask)),
      });
      return;
    }

    this.typeOut(aiId, demoTextReply(text, skill, mask));
  },

  typeOut(aiId, full) {
    let i = 0;
    if (this._timer) clearInterval(this._timer);
    this.updateMessage(aiId, { loading: false, content: '' });
    this._timer = setInterval(() => {
      i += 3;
      const done = i >= full.length;
      this.updateMessage(aiId, { content: full.slice(0, i), loading: false });
      if (done) {
        clearInterval(this._timer);
        this._timer = null;
        this.setData({ busy: false, canSend: false }, () => this.saveCurrentSession());
      }
    }, 16);
  },

  sendImage(prompt) {
    const userMsg = { id: uid(), role: 'user', content: `🎨 ${prompt}` };
    const aiId = uid();
    this.pushMessages(
      [
        userMsg,
        {
          id: aiId,
          role: 'ai',
          content: '呆呆 AI 正在生成图片…',
          loading: true,
        },
      ],
      {
        input: '',
        canSend: false,
        busy: true,
      }
    );

    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';
    const size = this.data.imageSize;

    if (!apiBase) {
      setTimeout(() => {
        this.updateMessage(aiId, {
          loading: false,
          content: `呆呆 AI 已收到生图需求：「${prompt.slice(0, 40)}」\n请先配置服务后再生成真实图片。`,
          image: demoImagePath(),
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
      }, 600);
      return;
    }

    wx.request({
      url: `${apiBase.replace(/\/$/, '')}/api/image`,
      method: 'POST',
      timeout: 180000,
      data: { prompt, size },
      success: (res) => {
        const data = res.data || {};
        if (data.image) {
          this.updateMessage(aiId, {
            loading: false,
            content: '',
            image: data.image,
          });
        } else {
          this.updateMessage(aiId, {
            loading: false,
            content: friendlyError(data.error?.message),
            image: '',
          });
        }
        this.setData({ busy: false }, () => this.saveCurrentSession());
      },
      fail: (err) => {
        this.updateMessage(aiId, {
          loading: false,
          content: friendlyError(err.errMsg),
        });
        this.setData({ busy: false });
      },
    });
  },

  sendImageEdit(prompt) {
    if (!this.data.editImagePath || !this.data.editImageB64) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      this.pickEditImage();
      return;
    }

    const srcPath = this.data.editImagePath;
    const userMsg = {
      id: uid(),
      role: 'user',
      content: `🖌️ ${prompt}`,
      image: srcPath,
    };
    const aiId = uid();
    this.pushMessages(
      [
        userMsg,
        {
          id: aiId,
          role: 'ai',
          content: '呆呆 AI 正在改图…',
          loading: true,
        },
      ],
      {
        input: '',
        canSend: false,
        busy: true,
      }
    );

    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';
    const size = this.data.imageSize;
    const mime = this.data.editMime || 'image/jpeg';
    const image_b64 = this.data.editImageB64;

    if (!apiBase) {
      setTimeout(() => {
        this.updateMessage(aiId, {
          loading: false,
          content: `呆呆 AI 已收到改图需求：「${prompt.slice(0, 40)}」\n请先配置服务后再生成真实结果。`,
          image: srcPath,
        });
        this.setData({ busy: false, canSend: false }, () => this.saveCurrentSession());
      }, 700);
      return;
    }

    wx.request({
      url: `${apiBase.replace(/\/$/, '')}/api/image/edit`,
      method: 'POST',
      timeout: 180000,
      data: {
        prompt,
        image_b64,
        mime,
        size,
      },
      success: (res) => {
        const data = res.data || {};
        if (data.image) {
          this.updateMessage(aiId, {
            loading: false,
            content: '',
            image: data.image,
          });
        } else {
          this.updateMessage(aiId, {
            loading: false,
            content: friendlyError(data.error?.message),
            image: '',
          });
        }
        this.setData({ busy: false }, () => this.saveCurrentSession());
      },
      fail: (err) => {
        this.updateMessage(aiId, {
          loading: false,
          content: friendlyError(err.errMsg),
        });
        this.setData({ busy: false });
      },
    });
  },
});
