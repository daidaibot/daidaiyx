const {
  BUILTIN_MASKS,
  EMOJI_PRESETS,
  allMasks,
  findMask,
  loadCustomMasks,
  refreshCustomMasksFromServer,
  createCustomMask,
  deleteCustomMask,
} = require('../../utils/masks');
const {
  getUser,
  isLoggedIn,
  sendLoginCode,
  loginWithCode,
  clearSession,
  authHeader,
  getToken,
} = require('../../utils/auth');
const {
  loadHistory,
  loadHistoryFromServer,
  openSessionFromServer,
  syncAllLocalToServer,
  saveSession,
  getSession,
  removeSession,
  clearHistory,
  clearLocalCache,
} = require('../../utils/history');
const { getLayout } = require('../../utils/layout');
const { checkServiceReady } = require('../../utils/status');

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
    id: 'vision',
    name: '识图',
    desc: '上传图片，问它是什么',
    emoji: '👁️',
    bg: 'rgba(99,102,241,0.12)',
    placeholder: '先上传图片，再提问（如：这是什么？）…',
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
    '你是「呆呆 AI」，由呆呆网络提供。对外只称呼自己为呆呆 AI，不要提及任何底层模型、厂商或 API 名称。' +
    '你只负责理解用户意图、聊天和引导确认，不能生成或修改图片。图片生成/改图只能由系统图片接口完成。' +
    '若用户想生成图片/照片/海报/壁纸等，不要口头答应「我帮你生成了」「马上出图」或假装已经画好；' +
    '请用一两句话确认需求，并提醒用户点击对话里的「生成图片」按钮（或先说清楚想画什么）。真正出图由系统完成。' +
    '若用户想改图或在上一张图基础上修改，不要口头答应已改好，也不要自己编造「已改图/已生成图片」之类的结果；改图由系统自动处理。' +
    '对话历史里以「（系统事件：…）」开头的内容是系统状态说明，表示图片已经成功生成/修改并展示给用户；' +
    '你只需据此了解上下文，禁止把系统事件文本原样复述给用户，也禁止模仿这种格式回复。' +
    '用户再问「看到了吗 / 这张图 / 照片」时，明确确认图片已生成且你清楚刚才的出图结果，禁止再说「还没生成 / 系统暂时没图 / 请稍等马上就来」。';
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

/** 生图/改图成功后的短说明：界面可显示，也会进 DeepSeek 上下文 */
function imageDoneNote(prompt, kind) {
  const p = String(prompt || '')
    .replace(/^🎨\s*/, '')
    .replace(/^🖌️\s*/, '')
    .trim()
    .slice(0, 120);
  if (kind === 'edit') {
    const m = p.match(/把(.{1,40})换(成|为)(.{1,60})/);
    if (m) {
      return `已改图：将「${m[1].trim()}」替换为「${m[3].trim()}」。`;
    }
    return p ? `已按你的要求改好图：「${p}」。` : '已按你的要求改好图。';
  }
  return p ? `已生成图片：「${p}」。` : '已生成图片。';
}

/** 普通聊天接口不能宣称图片已生成/已改图；只有图片接口返回图片后才允许这么说 */
function guardChatOnlyReply(content, userText) {
  const text = String(content || '');
  const user = String(userText || '');
  const fakeImageResult =
    /【已生成图片】|【已改图】|已生成图片|已经生成图片|图片已生成|已生成.*(图片|照片|海报)|已改图|已经改图|图片已展示|已展示在对话里|改图结果|生成结果/.test(
      text
    );
  if (!fakeImageResult) return text;
  if (looksLikeImageEditRequest(user) || /上一张|这张|改图|修改|替换|换(成|为|了)|颜色|文字|背景|风格/.test(user)) {
    return '我还没有真正改图。请先点对话里的「确认改图」，系统会用上一张图调用图片接口修改，成功后才会显示新图片。';
  }
  if (looksLikeImageRequest(user) || /图片|照片|海报|画|生成|出图|做图/.test(user)) {
    return '我还没有真正生成图片。请先点对话里的「生成图片」确认，系统会调用图片接口生成，成功后才会显示图片。';
  }
  return '我还没有真正生成或修改图片。只有系统图片接口成功返回图片后，我才会显示“已生成图片/已改图”。';
}

/**
 * 把 UI 消息转成对话上游可用的文本历史（DeepSeek 看不懂图，用文字桥接）
 * 常见做法：工具/生图结果写成 assistant 文本事件，再继续聊。
 */
function messagesToChatHistory(messages, buildQuotedContentFn) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && !m.loading && (m.content || m.image))
    .slice(-16)
    .map((m) => {
      if (m.role === 'user') {
        let content = String(m.content || '');
        if (m.image && !content) content = '【用户上传了一张图片，用于改图】';
        else if (m.image) content = `${content}\n（用户附带了一张参考图）`;
        if (m.quote && typeof buildQuotedContentFn === 'function') {
          content = buildQuotedContentFn(content, m.quote, (m.quote && m.quote.mode) || 'quote');
        }
        return { role: 'user', content };
      }
      if (m.image) {
        const kind = m.imageKind === 'edit' ? 'edit' : 'generate';
        const note =
          m.content && !/正在|请稍候|作图中|改图中/.test(m.content)
            ? String(m.content)
            : imageDoneNote(m.imagePrompt || '', kind);
        // 只做「事实陈述」，不要写成会被模型照抄的指令文案
        return {
          role: 'assistant',
          content: `（系统事件：${note}图片已展示在对话里。）`,
        };
      }
      return { role: 'assistant', content: String(m.content || '') };
    })
    .filter((m) => m.content);
}

/** 普通对话框里识别「要出图 / 照片」意图 */
function looksLikeImageRequest(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^🎨/.test(s)) return true;
  if (
    /生图|文生图|画一张|画一幅|画个|画张|帮我画|来[一张张]?图|出[一张张]?图|做[一张张]?图|出图|做图|海报设计|封面图|宣传图|广告图/.test(
      s
    )
  ) {
    return true;
  }
  if (
    /生成.*(图|照片|相片|海报|封面|插画|壁纸|logo|图标|头像|写真)|做[一张个].*(图|海报|封面|照片)|画一[张幅].{0,20}/i.test(
      s
    )
  ) {
    return true;
  }
  if (
    /(想|要|帮我|给我|来).{0,8}(一张|一个|张).{0,12}(照片|相片|图|海报|封面|壁纸|插画|头像|写真)/.test(s)
  ) {
    return true;
  }
  if (/(照片|相片|壁纸|插画|海报|封面).{0,6}(生成|画|做|出)/.test(s)) {
    return true;
  }
  return false;
}

function stripImageCue(text) {
  return String(text || '')
    .replace(/^🎨\s*/, '')
    .trim();
}

function stripEditCue(text) {
  return String(text || '')
    .replace(/^🖌️\s*/, '')
    .trim();
}

/** 从对话里找最近一张已完成的 AI 出图/改图结果 */
function findLastResultImage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.role === 'ai' && m.image && !m.loading) {
      return {
        url: m.image,
        messageId: m.id,
        imageKind: m.imageKind || 'generate',
      };
    }
  }
  return null;
}

/** 普通聊天里识别「基于上一张图改图」意图 */
function looksLikeImageEditRequest(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^🖌️/.test(s)) return true;
  const refsPrev =
    /这一张|这张|这幅|这个图|刚才(的)?图|上面(那张)?图|之前(的)?图|刚生成|刚画|刚做的图|上一张|上一幅|基于.*图|在这张|在这幅|在这一张|刚才那张|上面那张/.test(
      s
    );
  // 修改类意图：换/改/调整/去掉/加 等，以及“颜色/文字/字体/背景/logo”等要素被修改
  const editIntent =
    /改(一下|改|图|色|成|为|掉)?|修改|替换|换(成|为|掉|了|一下|个|新|下)|更改|去掉|删掉|删除|加(上|个)?|添加|P掉|p掉|抠图|涂抹|微调|调整|调一下|重做|重画|再画|美化|优化(一下)?/.test(
      s
    );
  if (refsPrev && editIntent) return true;
  // 明确要素被修改（颜色/文字/字体/背景/风格）也算改图
  if (
    refsPrev &&
    /(颜色|色调|配色|文字|字体|文案|标题|背景|风格|样式|尺寸|大小|logo|图标)/i.test(s)
  ) {
    return true;
  }
  if (/^(帮我)?改图[：:]|基于上一张|在这张图(片)?上|把上一张/.test(s)) return true;
  if (/把「.+」换(成|为)「.+」|把".+"换(成|为)".+"/.test(s)) return true;
  return false;
}

function friendlyError(msg) {
  const s = String(msg || '');
  if (
    /api.?key|OPENAI|DeepSeek|deepseek|gpt-?image|openai|dall-?e|unauthorized|401|403|503|未配置|未就绪/i.test(
      s
    )
  ) {
    return '呆呆 AI 暂时不可用，请稍后再试';
  }
  if (/timeout|超时|fail|network|ERR_/i.test(s)) {
    return '网络不太稳定，请稍后再试';
  }
  if (!s) return '';
  // 去掉可能泄露的英文厂商词
  return s
    .replace(/DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|DALL·E|Claude/gi, '呆呆 AI')
    .slice(0, 120);
}

function reportClientError(a, b) {
  try {
    let apiBase = '';
    let payload = {};
    if (typeof a === 'string') {
      apiBase = a;
      payload = b || {};
    } else {
      payload = a || {};
      const app = getApp();
      apiBase = (app.globalData && app.globalData.apiBase) || '';
    }
    const base = String(apiBase || '').replace(/\/$/, '');
    if (!base) return;
    wx.request({
      url: `${base}/api/report-error`,
      method: 'POST',
      timeout: 8000,
      header: { 'Content-Type': 'application/json' },
      data: payload,
      fail: () => {},
    });
  } catch (e) {
    /* ignore */
  }
}

function formatImageFail(res, data, prompt) {
  const rawMsg =
    (data && data.error && data.error.message) ||
    (typeof (data && data.error) === 'string' ? data.error : '') ||
    (data && data.message) ||
    '';
  const errId = (data && data.error && data.error.id) || '';
  const status = (res && res.statusCode) || '?';
  const tip =
    friendlyError(rawMsg) ||
    rawMsg ||
    `生图失败（HTTP ${status}）`;
  const lines = [tip];
  if (errId) lines.push(`错误编号：${errId}`);
  lines.push('请到管理后台 → 错误日志 查看明细');
  return {
    tip: lines.join('\n'),
    rawMsg: rawMsg || tip,
    status,
    errId,
  };
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
    imageSize: '1152x1536',
    editImagePath: '',
    editImageB64: '',
    editMime: 'image/jpeg',
    entered: true,
    loggedIn: false,
    loginLoading: false,
    loginAccount: '',
    loginCode: '',
    codeCooling: false,
    codeSending: false,
    codeLeft: 60,
    loginNick: '',
    loginAvatar: '',
    user: { nickName: '游客', avatarUrl: '' },
    showDrawer: false,
    showProfile: false,
    profileLoading: false,
    profile: {
      nickName: '用户',
      avatarUrl: '',
      account: '',
      isMember: false,
      quotaText: '剩余 2 / 2 次',
      chatToday: 0,
      imageToday: 0,
    },
    isMember: false,
    memberSinceText: '',
    historyList: [],
    sessionId: '',
    sizes: [
      { label: '原比例', value: 'auto' },
      { label: '1:1', value: '1024x1024' },
      { label: '3:4', value: '1152x1536' },
      { label: '3:2', value: '1536x1024' },
    ],
    showMsgMenu: false,
    msgMenuTop: 120,
    msgMenuLeft: 80,
    msgMenuMsgId: '',
    msgMenuCanEdit: false,
    quoteMsg: null,
    quoteMode: '',
    editingMsgId: '',
    inputFocus: false,
    keyboardHeight: 0,
  },

  _timer: null,
  _msgMenuMsg: null,
  _kbHandler: null,

  noop() {},

  dismissKeyboard() {
    try {
      wx.hideKeyboard({ complete: () => {} });
    } catch (e) {
      /* ignore */
    }
    if (this.data.inputFocus || this.data.keyboardHeight) {
      this.setData({ inputFocus: false, keyboardHeight: 0 });
    }
  },

  onInputFocus(e) {
    const h = (e && e.detail && e.detail.height) || 0;
    this.setData({
      inputFocus: true,
      keyboardHeight: h > 0 ? h : this.data.keyboardHeight,
    });
  },

  onInputBlur() {
    this.setData({ inputFocus: false, keyboardHeight: 0 });
  },

  onKeyboardHeight(e) {
    const h = Math.max(0, Number((e && e.detail && e.detail.height) || 0));
    if (h === this.data.keyboardHeight) return;
    this.setData({ keyboardHeight: h, inputFocus: h > 0 });
  },

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
    this._kbHandler = (res) => {
      const h = Math.max(0, Number((res && res.height) || 0));
      if (h === this.data.keyboardHeight) return;
      this.setData({ keyboardHeight: h, inputFocus: h > 0 || this.data.inputFocus });
    };
    if (typeof wx.onKeyboardHeightChange === 'function') {
      wx.onKeyboardHeightChange(this._kbHandler);
    }
    this.refreshAuth();
    this.refreshMasks();
    this.refreshHistory();
    // 立刻显示页面，避免白屏；不要因状态检查失败把用户踢回首页（会造成来回跳）
    this.setData({ entered: true });
    if (isLoggedIn()) {
      loadHistoryFromServer()
        .then((list) => {
          this.setData({ historyList: list || [] });
          if (list && list.length) {
            try {
              this.restoreLatestSession();
            } catch (e) {
              console.warn('restoreLatestSession failed', e);
            }
          }
        })
        .catch(() => {});
    }
    checkServiceReady({ showModal: true }).then(() => {});
  },

  onUnload() {
    if (this._onResize && wx.offWindowResize) wx.offWindowResize(this._onResize);
    if (this._kbHandler && typeof wx.offKeyboardHeightChange === 'function') {
      wx.offKeyboardHeightChange(this._kbHandler);
    }
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
    if (!isLoggedIn()) {
      this.setData({ historyList: [] });
      return;
    }
    loadHistoryFromServer()
      .then((list) => {
        this.setData({ historyList: list || [] });
      })
      .catch(() => {
        this.setData({ historyList: loadHistory() });
      });
  },

  restoreLatestSession() {
    const list = loadHistory();
    if (!list.length) return;
    this.openSessionById(list[0].id, { silent: true });
  },

  openSessionById(id, opts = {}) {
    if (!id) return false;
    const openLocal = (sess) => {
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
          messages: sess.messages.map((m) => Object.assign({}, m, { loading: false })),
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
          imageSize: meta.imageSize || '1152x1536',
          showDrawer: false,
          input: '',
          canSend: false,
          busy: false,
          placeholder: meta.activeSkill
            ? skillById(meta.activeSkill)?.placeholder || '有问题，尽管问'
            : meta.activeMask
              ? `以「${meta.maskLabel}」继续说…`
              : '有问题，尽管问',
        },
        () => {
          setTimeout(() => this.setData({ scrollInto: 'm-bottom' }), 80);
        }
      );
      return true;
    };

    if (isLoggedIn()) {
      openSessionFromServer(id)
        .then((sess) => openLocal(sess))
        .catch(() => openLocal(getSession(id)));
      return true;
    }
    return openLocal(getSession(id));
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
    if (!isLoggedIn()) {
      this.setData({
        customMasks: [],
        maskPreview: allMasks().slice(0, 10),
      });
      return;
    }
    refreshCustomMasksFromServer()
      .then(() => {
        this.setData({
          customMasks: loadCustomMasks(),
          maskPreview: allMasks().slice(0, 10),
        });
      })
      .catch(() => {
        this.setData({
          customMasks: loadCustomMasks(),
          maskPreview: allMasks().slice(0, 10),
        });
      });
  },

  onChooseAvatar() {},

  onNickInput(e) {
    this.setData({ loginNick: (e.detail && e.detail.value) || '' });
  },

  onAccountInput(e) {
    this.setData({ loginAccount: (e.detail && e.detail.value) || '' });
  },

  onCodeInput(e) {
    this.setData({ loginCode: (e.detail && e.detail.value) || '' });
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

  /** 维护检查 + 登录后再执行 */
  withService(fn) {
    checkServiceReady().then((st) => {
      if (!st.ok) return;
      if (!this.ensureLogin()) return;
      fn.call(this);
    });
  },

  _startCodeCooldown(sec) {
    if (this._codeTimer) clearInterval(this._codeTimer);
    let left = Number(sec) || 60;
    this.setData({ codeCooling: true, codeLeft: left });
    this._codeTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._codeTimer);
        this._codeTimer = null;
        this.setData({ codeCooling: false, codeLeft: 60 });
        return;
      }
      this.setData({ codeLeft: left });
    }, 1000);
  },

  _afterLoginSuccess(user) {
    this.setData({
      loggedIn: true,
      user,
      loginLoading: false,
      loginCode: '',
      showLogin: false,
      showDrawer: false,
      welcomeSub: '我是呆呆 AI · 聊天写作编程 · 生图改图',
      navSub: '随时帮忙',
    });
    this.refreshMasks();
    this.fetchMyProfile({ silent: true });
    loadHistoryFromServer()
      .then((list) => {
        this.setData({ historyList: list || [] });
        if (!this.data.messages.length && list && list.length) {
          this.restoreLatestSession();
        }
      })
      .catch(() => this.refreshHistory());
    wx.showToast({ title: '登录成功', icon: 'success' });
  },

  onSendCode() {
    if (this.data.codeCooling || this.data.codeSending) return;
    const account = String(this.data.loginAccount || '').trim();
    if (!account) {
      wx.showToast({ title: '请先填写邮箱', icon: 'none', duration: 2500 });
      return;
    }
    const isAllowedEmail =
      /^[a-z0-9._-]{1,64}@(qq\.com|gmail\.com|googlemail\.com|163\.com|126\.com|yeah\.net|vip\.163\.com|vip\.126\.com|188\.com)$/i.test(
        account
      );
    if (!isAllowedEmail) {
      wx.showModal({
        title: '邮箱暂不支持',
        content: '目前支持 QQ、Gmail、网易邮箱（@qq.com / @gmail.com / @163.com 等）',
        showCancel: false,
      });
      return;
    }
    this.setData({ codeSending: true });
    wx.showLoading({ title: '发送中', mask: true });
    sendLoginCode(account)
      .then((data) => {
        wx.hideLoading();
        this.setData({ codeSending: false });
        this._startCodeCooldown(data.cooldownSec || 60);
        const shown = data.previewCode || data.devCode;
        if (shown) {
          this.setData({ loginCode: String(shown) });
          wx.showModal({
            title: '验证码',
            content: `${data.message || '验证码'}：${shown}`,
            showCancel: false,
          });
          return;
        }
        wx.showModal({
          title: '已发送',
          content: data.message || '验证码已发送，请查收邮箱（含垃圾箱）',
          showCancel: false,
        });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ codeSending: false });
        wx.showModal({
          title: '发送失败',
          content: (err && err.message) || '网络错误，请稍后重试',
          showCancel: false,
        });
      });
  },

  onCodeLogin() {
    if (this.data.loginLoading) return;
    const account = String(this.data.loginAccount || '').trim();
    const code = String(this.data.loginCode || '').trim();
    if (!account) {
      wx.showToast({ title: '请输入邮箱', icon: 'none' });
      return;
    }
    if (!code) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return;
    }
    this.setData({ loginLoading: true });
    loginWithCode(account, code)
      .then((user) => this._afterLoginSuccess(user))
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
    clearLocalCache();
    clearHistory();
    this.setData({
      loggedIn: false,
      user: { nickName: '游客', avatarUrl: '' },
      showDrawer: false,
      showLogin: false,
      messages: [],
      sessionId: '',
      historyList: [],
      customMasks: [],
      maskPreview: allMasks().slice(0, 10),
      welcomeSub: '游客可逛 · 使用功能需登录',
      navSub: '游客模式',
      showProfile: false,
      profile: {
        nickName: '用户',
        avatarUrl: '',
        account: '',
        isMember: false,
        quotaText: '剩余 2 / 2 次',
        chatToday: 0,
        imageToday: 0,
      },
      isMember: false,
      memberSinceText: '',
    });
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
    // 静默刷新会员身份，让抽屉里的徽章保持最新
    if (isLoggedIn()) this.fetchMyProfile({ silent: true });
  },

  closeDrawer() {
    this.setData({ showDrawer: false });
  },

  /** 拉取我的资料（会员身份 + 今日额度） */
  fetchMyProfile(opts = {}) {
    const app = getApp();
    const apiBase = ((app.globalData && app.globalData.apiBase) || '').replace(/\/$/, '');
    if (!apiBase || !isLoggedIn()) return Promise.resolve(this.data.profile || null);
    if (!opts.silent) this.setData({ profileLoading: true });
    return new Promise((resolve) => {
      wx.request({
        url: `${apiBase}/api/me`,
        method: 'GET',
        timeout: 12000,
        header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
        success: (res) => {
          const data = typeof res.data === 'object' && res.data ? res.data : {};
          if (res.statusCode === 200 && data.ok && data.user) {
            const q = data.imageQuota || {};
            const t = data.today || {};
            const joined = Number(data.user.createdAt || 0);
            const memberSinceText = joined
              ? `${new Date(joined).getFullYear()}-${String(
                  new Date(joined).getMonth() + 1
                ).padStart(2, '0')}-${String(new Date(joined).getDate()).padStart(2, '0')}`
              : '';
            const profile = {
              nickName: data.user.nickName || '用户',
              avatarUrl: data.user.avatarUrl || '',
              account: data.user.email || data.user.phone || '',
              isMember: !!data.user.isMember,
              quotaText: q.unlimited
                ? '不限次数'
                : `剩余 ${q.remaining != null ? q.remaining : Math.max(0, 2 - (q.used || 0))} / ${
                    q.limit || 2
                  } 次`,
              chatToday: Number(t.chatOk || 0),
              imageToday: Number(t.imageUsed || 0),
            };
            this.setData({
              profile,
              isMember: profile.isMember,
              memberSinceText,
              profileLoading: false,
            });
            resolve(profile);
            return;
          }
          this.setData({ profileLoading: false });
          resolve(this.data.profile || null);
        },
        fail: () => {
          this.setData({ profileLoading: false });
          resolve(this.data.profile || null);
        },
      });
    });
  },

  /** 点击抽屉头像区域：登录用户看个人卡片，游客去登录 */
  onOpenProfile() {
    if (!isLoggedIn()) {
      this.openLogin();
      return;
    }
    this.setData({ showProfile: true });
    this.fetchMyProfile();
  },

  closeProfile() {
    this.setData({ showProfile: false });
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
    if (this.data.activeSkill === 'edit' || this.data.activeSkill === 'vision') {
      return !!text && !!this.data.editImagePath;
    }
    return !!text;
  },

  msgPreview(msg) {
    if (!msg) return '';
    if (msg.content) return String(msg.content).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (msg.image) return '[图片]';
    return '';
  },

  msgWho(msg) {
    return msg && msg.role === 'user' ? '我' : '呆呆 AI';
  },

  onMsgLongPress(e) {
    this.openMsgMenu(e.currentTarget.dataset.id, e);
  },

  onMsgTap() {
    this.dismissKeyboard();
  },

  openMsgMenu(id, e) {
    const msg = (this.data.messages || []).find((m) => m.id === id);
    if (!msg || msg.loading) return;
    this._msgMenuMsg = msg;
    const touch =
      (e && e.touches && e.touches[0]) ||
      (e && e.changedTouches && e.changedTouches[0]) ||
      (e && e.detail) ||
      {};
    const sys =
      (typeof wx.getWindowInfo === 'function' && wx.getWindowInfo()) ||
      (typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync()) ||
      { windowWidth: 375, windowHeight: 667 };
    const menuW = 120;
    const menuH = msg.role === 'user' ? 200 : 160;
    let left = Number(touch.clientX || touch.x || sys.windowWidth / 2) - menuW / 2;
    let top = Number(touch.clientY || touch.y || 160) - menuH - 12;
    left = Math.max(12, Math.min(left, (sys.windowWidth || 375) - menuW - 12));
    top = Math.max(12, Math.min(top, (sys.windowHeight || 667) - menuH - 12));
    this.setData({
      showMsgMenu: true,
      msgMenuTop: top,
      msgMenuLeft: left,
      msgMenuMsgId: id,
      msgMenuCanEdit: msg.role === 'user' && !!msg.content,
    });
  },

  closeMsgMenu() {
    this.setData({ showMsgMenu: false, msgMenuMsgId: '', msgMenuCanEdit: false });
    this._msgMenuMsg = null;
  },

  clearQuote() {
    this.setData({ quoteMsg: null, quoteMode: '' });
  },

  clearEditing() {
    this.setData({ editingMsgId: '', input: '', canSend: false });
  },

  onMsgMenuAct(e) {
    const act = e.currentTarget.dataset.act;
    const msg = this._msgMenuMsg || (this.data.messages || []).find((m) => m.id === this.data.msgMenuMsgId);
    this.closeMsgMenu();
    if (!msg) return;

    if (act === 'copy') {
      const text = msg.content || (msg.image ? msg.image : '');
      if (!text) {
        wx.showToast({ title: '无可复制内容', icon: 'none' });
        return;
      }
      wx.setClipboardData({
        data: String(text),
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
      return;
    }

    if (act === 'reply' || act === 'quote') {
      this.setData({
        quoteMsg: {
          id: msg.id,
          who: this.msgWho(msg),
          preview: this.msgPreview(msg),
          content: msg.content || '',
          image: msg.image || '',
        },
        quoteMode: act,
        editingMsgId: '',
      });
      return;
    }

    if (act === 'edit') {
      if (msg.role !== 'user' || !msg.content) {
        wx.showToast({ title: '只能修改自己的文字消息', icon: 'none' });
        return;
      }
      this.setData({
        editingMsgId: msg.id,
        input: msg.content,
        canSend: true,
        quoteMsg: null,
        quoteMode: '',
        activeSkill: '',
        skillLabel: '',
      });
    }
  },

  buildQuotedContent(text, quote, mode) {
    if (!quote) return text;
    const label = mode === 'reply' ? '回复' : '引用';
    const snippet = quote.content
      ? String(quote.content).slice(0, 200)
      : quote.image
        ? '[图片]'
        : quote.preview || '';
    return `${label}「${quote.who || ''}」：\n> ${snippet}\n\n${text}`;
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

  defaultSizeForSkill(id) {
    if (id === 'edit') return '1152x1536';
    if (id === 'image') return '1152x1536';
    return this.data.imageSize || '1152x1536';
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
    const patch = {
      activeSkill: id,
      skillLabel: skill.name,
      placeholder: skill.placeholder,
      showSheet: false,
      imageSize: this.defaultSizeForSkill(id),
    };
    if (id !== 'edit' && id !== 'vision') {
      patch.editImagePath = '';
      patch.editImageB64 = '';
    }
    this.setData(patch, () => {
      this.setData({ canSend: this.computeCanSend(this.data.input) });
      if ((id === 'edit' || id === 'vision') && !this.data.editImagePath) {
        this.pickAttachImage(id);
      }
    });
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

  /** 生图/改图成功后回到普通聊天，避免下一条又触发出图 */
  finishVisualSkillAfterDone() {
    if (
      this.data.activeSkill === 'image' ||
      this.data.activeSkill === 'edit' ||
      this.data.activeSkill === 'vision'
    ) {
      this.setSkill('');
    }
  },

  applyMask(mask) {
    if (!mask) return;
    this.withService(() => {
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
    });
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

  /** 相对路径补全为云托管绝对地址；本地临时文件原样返回 */
  absoluteImageUrl(src) {
    const s = String(src || '').trim();
    if (!s) return '';
    if (this.isLocalImagePath(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    const app = getApp();
    const base = String((app.globalData && app.globalData.apiBase) || '').replace(/\/$/, '');
    if (!base) return s;
    return `${base}${s.startsWith('/') ? s : `/${s}`}`;
  },

  isLocalImagePath(src) {
    const s = String(src || '');
    if (!s) return false;
    if (/^wxfile:\/\//i.test(s)) return true;
    if (/^http:\/\/(tmp|usr)\//i.test(s)) return true;
    if (s.startsWith('/')) return false;
    if (/^https?:\/\//i.test(s)) return false;
    return true;
  },

  /** 把对话里的图片 URL 或本地路径读成 base64，供改图 API 使用 */
  downloadImageAsB64(src) {
    const url = this.absoluteImageUrl(src);
    return new Promise((resolve, reject) => {
      const readLocal = (filePath) => {
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: 'base64',
          success: (r) => {
            if (!r.data) {
              reject(new Error('读取图片失败'));
              return;
            }
            const lower = String(filePath || '').toLowerCase();
            const mime = /\.png(\?|$)/.test(lower) ? 'image/png' : 'image/jpeg';
            resolve({ b64: r.data, path: filePath, mime });
          },
          fail: () => reject(new Error('读取图片失败')),
        });
      };
      if (this.isLocalImagePath(url)) {
        readLocal(url);
        return;
      }
      wx.downloadFile({
        url,
        success: (res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            readLocal(res.tempFilePath);
            return;
          }
          reject(new Error(`下载图片失败 ${res.statusCode || ''}`));
        },
        fail: (err) =>
          reject(new Error((err && err.errMsg) || '下载图片失败，请检查 downloadFile 合法域名')),
      });
    });
  },

  /** 普通聊天里：基于上一张出图结果先确认，再改图 */
  startChatImageEdit(text, ref) {
    const prompt = stripEditCue(text);
    if (!prompt) return;
    const userMsg = { id: uid(), role: 'user', content: text };
    const confirmId = uid();
    this.pushMessages(
      [
        userMsg,
        {
          id: confirmId,
          role: 'ai',
          content: `我理解你想基于上一张照片来改图：\n「${prompt.slice(
            0,
            120
          )}」\n\n确认后我会用上一张图作为底图开始修改。`,
          imageEditConfirm: true,
          imageEditPromptDraft: prompt,
          imageEditRef: ref,
        },
      ],
      {
        input: '',
        canSend: false,
        scrollInto: `m-${confirmId}`,
      }
    );
    this.saveCurrentSession();
  },

  runConfirmedImageEdit(prompt, ref, aiId, userContent) {
    this.downloadImageAsB64((ref && ref.url) || '')
      .then(({ b64, path, mime }) => {
        this.sendImageEdit(prompt, {
          skipUserBubble: true,
          aiId,
          imagePath: path,
          imageB64: b64,
          mime,
          userContent: userContent || prompt,
        });
      })
      .catch((err) => {
        this.updateMessage(aiId, {
          loading: false,
          imageEditConfirm: false,
          imageEditPromptDraft: '',
          imageEditRef: null,
          content: (err && err.message) || '无法读取上一张图片，请重试或手动上传改图。',
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
      });
  },

  previewImage(e) {
    const raw = e.currentTarget.dataset.src;
    const src = this.absoluteImageUrl(raw);
    if (!src) {
      wx.showToast({ title: '图片地址无效', icon: 'none' });
      return;
    }
    // 气泡里所有云图一起左右滑预览
    const urls = (this.data.messages || [])
      .map((m) => this.absoluteImageUrl(m && m.image))
      .filter((u) => u && !this.isLocalImagePath(u));
    const all = this.isLocalImagePath(src)
      ? [src]
      : urls.length
        ? urls
        : [src];
    wx.previewImage({
      urls: all,
      current: src,
      fail: (err) => {
        wx.showModal({
          title: '无法预览',
          content:
            (err && err.errMsg) ||
            '请在微信公众平台把云托管域名加入「downloadFile 合法域名」，与 request 合法域名相同。',
          showCancel: false,
        });
      },
    });
  },

  downloadImage(e) {
    const raw = String(e.currentTarget.dataset.src || '');
    const src = this.absoluteImageUrl(raw);
    if (!src) {
      wx.showToast({ title: '图片地址无效', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中', mask: true });
    const finish = (ok, tip) => {
      wx.hideLoading();
      wx.showToast({ title: tip || (ok ? '已保存到相册' : '保存失败'), icon: ok ? 'success' : 'none' });
    };
    const saveTemp = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => finish(true, '已保存到相册'),
        fail: (err) => {
          const msg = String((err && err.errMsg) || '');
          if (/auth deny|authorize|privacy|permission/i.test(msg)) {
            wx.hideLoading();
            wx.showModal({
              title: '需要相册权限',
              content: '请允许保存到相册',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({});
              },
            });
            return;
          }
          finish(false, '保存失败');
        },
      });
    };
    // 改图时用户上传的原图是本地临时路径，直接存相册
    if (this.isLocalImagePath(src)) {
      saveTemp(src);
      return;
    }
    wx.downloadFile({
      url: src,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          saveTemp(res.tempFilePath);
        } else {
          finish(false, `下载失败 ${res.statusCode || ''}`);
        }
      },
      fail: (err) => {
        finish(
          false,
          /url not in domain|合法域名/i.test(String((err && err.errMsg) || ''))
            ? '请配置 downloadFile 合法域名'
            : '下载失败'
        );
      },
    });
  },

  onSend() {
    this.withService(() => {
      const text = (this.data.input || '').trim();
      if (!text || this.data.busy) return;
      this.dismissKeyboard();
      if (this.data.editingMsgId) {
        this.sendEditMessage(text);
        return;
      }
      if (this.data.activeSkill === 'edit') {
        this.sendImageEdit(text);
        return;
      }
      if (this.data.activeSkill === 'vision') {
        this.sendVision(text);
        return;
      }
      this.routeUserMessage(text).catch((err) => {
        wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' });
        this.setData({ canSend: this.computeCanSend(this.data.input) });
      });
    });
  },

  /** 调用 DeepSeek 分析生图/改图意向，再决定走确认生图、确认改图或普通聊天 */
  fetchChatIntent(text, hasRecentImage) {
    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';
    if (!apiBase) {
      return Promise.reject(new Error('未连接服务器'));
    }
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${apiBase.replace(/\/$/, '')}/api/chat/intent`,
        method: 'POST',
        timeout: 15000,
        header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
        data: {
          text,
          hasRecentImage: !!hasRecentImage,
        },
        success: (res) => {
          const data = typeof res.data === 'object' && res.data ? res.data : {};
          if (res.statusCode >= 200 && res.statusCode < 300 && data.ok) {
            resolve(data);
            return;
          }
          reject(
            new Error(
              (data.error && data.error.message) ||
                `意图分析失败(${res.statusCode || '?'})`
            )
          );
        },
        fail: (err) =>
          reject(new Error((err && err.errMsg) || '网络错误，请稍后再试')),
      });
    });
  },

  routeUserMessage(text) {
    const lastImg = findLastResultImage(this.data.messages);
    // 用户主动点了「生图」技能，直接走确认，不再调意向分析
    if (this.data.activeSkill === 'image') {
      this.offerImageConfirm(text);
      return Promise.resolve();
    }

    this.setData({ canSend: false });

    const fallbackRoute = () => {
      if (lastImg && looksLikeImageEditRequest(text)) {
        this.startChatImageEdit(text, lastImg);
        return;
      }
      if (looksLikeImageRequest(text)) {
        this.offerImageConfirm(text);
        return;
      }
      this.sendText(text);
    };

    return this.fetchChatIntent(text, !!lastImg)
      .then((data) => {
        const intent = String(data.intent || 'chat');
        const prompt = String(data.prompt || text).trim();
        if (intent === 'image_edit' && lastImg) {
          this.startChatImageEdit(text, lastImg);
          return;
        }
        if (intent === 'image_generate') {
          this.offerImageConfirm(prompt || text);
          return;
        }
        this.sendText(text);
      })
      .catch(() => {
        fallbackRoute();
      });
  },

  offerImageConfirm(text) {
    const prompt = stripImageCue(text);
    if (!prompt) return;
    const userMsg = { id: uid(), role: 'user', content: text.startsWith('🎨') ? text : text };
    const confirmId = uid();
    // 弹出确认时就退出生图模式，避免确认后仍卡在「生图」
    this.setSkill('');
    this.pushMessages(
      [
        userMsg,
        {
          id: confirmId,
          role: 'ai',
          content: `看起来你想生成图片：\n「${prompt.slice(0, 120)}」\n\n确认后我会开始生成。`,
          imageConfirm: true,
          imagePromptDraft: prompt,
        },
      ],
      {
        input: '',
        canSend: false,
        imageSize: this.data.imageSize || '1152x1536',
        scrollInto: `m-${confirmId}`,
      }
    );
    this.saveCurrentSession();
  },

  onConfirmImageGen(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const msg = (this.data.messages || []).find((m) => String(m.id) === String(id));
    if (!msg || !msg.imagePromptDraft) return;
    this.dismissKeyboard();
    const prompt = String(msg.imagePromptDraft || '').trim();
    if (!prompt) return;
    // 一点「生成图片」就退出生图模式，后续消息走普通聊天
    this.setSkill('');
    this.updateMessage(id, {
      imageConfirm: false,
      content: '好的，开始生成图片…',
      loading: true,
    });
    this.sendImage(prompt, { skipUserBubble: true, aiId: id });
  },

  onCancelImageGen(e) {
    const id = e.currentTarget.dataset.id;
    this.dismissKeyboard();
    this.setSkill('');
    this.updateMessage(id, {
      imageConfirm: false,
      imagePromptDraft: '',
      content: '已取消生成。想画的时候再说一声就行。',
      loading: false,
    });
    this.saveCurrentSession();
  },

  onConfirmImageEdit(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const msg = (this.data.messages || []).find((m) => String(m.id) === String(id));
    if (!msg || !msg.imageEditPromptDraft || !msg.imageEditRef) return;
    this.dismissKeyboard();
    const prompt = String(msg.imageEditPromptDraft || '').trim();
    if (!prompt) return;
    this.setSkill('');
    this.updateMessage(id, {
      imageEditConfirm: false,
      imageEditPromptDraft: '',
      imageEditRef: null,
      content: '好的，开始基于上一张照片改图…',
      loading: true,
    });
    this.setData({ busy: true, input: '', canSend: false });
    this.runConfirmedImageEdit(prompt, msg.imageEditRef, id, prompt);
  },

  onCancelImageEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.dismissKeyboard();
    this.setSkill('');
    this.updateMessage(id, {
      imageEditConfirm: false,
      imageEditPromptDraft: '',
      imageEditRef: null,
      content: '已取消改图。需要改上一张图时再告诉我。',
      loading: false,
    });
    this.saveCurrentSession();
  },

  sendEditMessage(text) {
    const editId = this.data.editingMsgId;
    const msgs = this.data.messages || [];
    const idx = msgs.findIndex((m) => m.id === editId);
    if (idx < 0) {
      this.setData({ editingMsgId: '' });
      this.sendText(text);
      return;
    }
    // 修改：截断该条之后的内容，用新文案重新问
    const kept = msgs.slice(0, idx);
    this.setData(
      {
        messages: kept,
        editingMsgId: '',
        quoteMsg: null,
        quoteMode: '',
      },
      () => this.sendText(text)
    );
  },

  pickEditImage() {
    this.pickAttachImage('edit');
  },

  pickVisionImage() {
    this.pickAttachImage('vision');
  },

  onPickAttachImage() {
    const skill = this.data.activeSkill === 'vision' ? 'vision' : 'edit';
    this.pickAttachImage(skill);
  },

  pickAttachImage(skillId) {
    const skill = skillById(skillId) || skillById('edit');
    this.withService(() => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = (res.tempFiles && res.tempFiles[0]) || {};
          const path = file.tempFilePath;
          if (!path) return;
          if (file.size && file.size > 12 * 1024 * 1024) {
            wx.showToast({ title: '图片请小于 12MB', icon: 'none' });
            return;
          }
          const applyPath = (finalPath) => {
            const fs = wx.getFileSystemManager();
            fs.readFile({
              filePath: finalPath,
              encoding: 'base64',
              success: (r) => {
                if (!r.data || r.data.length > 12 * 1024 * 1024) {
                  wx.showToast({ title: '图片过大，请换一张', icon: 'none' });
                  return;
                }
                this.setData(
                  {
                    activeSkill: skill.id,
                    skillLabel: skill.name,
                    placeholder: skill.placeholder,
                    editImagePath: finalPath,
                    editImageB64: r.data,
                    editMime: 'image/jpeg',
                    imageSize: '1152x1536',
                    showSheet: false,
                  },
                  () => this.setData({ canSend: this.computeCanSend(this.data.input) })
                );
                wx.showToast({
                  title: skill.id === 'vision' ? '已选图，写下你的问题' : '已选图，写明怎么改',
                  icon: 'none',
                });
              },
              fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
            });
          };
          if (typeof wx.compressImage === 'function') {
            wx.compressImage({
              src: path,
              quality: 72,
              success: (c) => applyPath(c.tempFilePath || path),
              fail: () => applyPath(path),
            });
          } else {
            applyPath(path);
          }
        },
      });
    });
  },

  sendVision(prompt) {
    if (!this.data.editImagePath || !this.data.editImageB64) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      this.pickVisionImage();
      return;
    }
    const srcPath = this.data.editImagePath;
    const userMsg = {
      id: uid(),
      role: 'user',
      content: prompt,
      image: srcPath,
    };
    const aiId = uid();
    this.pushMessages(
      [
        userMsg,
        {
          id: aiId,
          role: 'ai',
          content: '呆呆 AI 正在识图…',
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
    if (!apiBase) {
      this.updateMessage(aiId, {
        loading: false,
        content: '请先配置服务后再识图。',
      });
      this.setData({ busy: false });
      return;
    }

    wx.request({
      url: `${apiBase.replace(/\/$/, '')}/api/vision`,
      method: 'POST',
      timeout: 90000,
      header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
      data: {
        prompt,
        image_b64: this.data.editImageB64,
        mime: this.data.editMime || 'image/jpeg',
      },
      success: (res) => {
        const data = typeof res.data === 'object' && res.data ? res.data : {};
        const content =
          data.content ||
          (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
          (data.error && data.error.message) ||
          `识图失败（${res.statusCode || '?'}）`;
        this.updateMessage(aiId, { loading: false, content: String(content) });
        this.setData({ busy: false }, () => {
          this.finishVisualSkillAfterDone();
          this.saveCurrentSession();
        });
      },
      fail: (err) => {
        this.updateMessage(aiId, {
          loading: false,
          content: (err && err.errMsg) || '识图网络失败',
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
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
    this.setData(
      Object.assign(
        {
          messages: this.data.messages.concat(list),
          scrollInto: 'm-bottom',
        },
        extra
      )
    );
  },

  updateMessage(id, patch) {
    const messages = this.data.messages.map((m) =>
      m.id === id ? Object.assign({}, m, patch) : m
    );
    this.setData({ messages, scrollInto: 'm-bottom' });
  },

  sendText(text) {
    const skill = this.data.activeSkill;
    const mask = findMask(this.data.activeMask);
    const quote = this.data.quoteMsg;
    const quoteMode = this.data.quoteMode;
    const displayText = text;
    const apiText = this.buildQuotedContent(text, quote, quoteMode);
    const history = messagesToChatHistory(
      this.data.messages,
      this.buildQuotedContent.bind(this)
    );

    const userMsg = {
      id: uid(),
      role: 'user',
      content: displayText,
      quote: quote
        ? {
            who: quote.who,
            preview: quote.preview,
            content: quote.content || '',
            mode: quoteMode || 'quote',
          }
        : null,
    };
    const aiId = uid();
    this.pushMessages(
      [userMsg, { id: aiId, role: 'ai', content: '', loading: true }],
      {
        input: '',
        canSend: false,
        busy: true,
        quoteMsg: null,
        quoteMode: '',
        editingMsgId: '',
      }
    );

    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';

    if (apiBase) {
      const doChatReq = (retry) => {
        wx.request({
          url: `${apiBase.replace(/\/$/, '')}/api/chat`,
          method: 'POST',
          timeout: 120000,
          header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
          data: {
            stream: false,
            messages: [{ role: 'system', content: systemPrompt(skill, mask) }]
              .concat(history)
              .concat([{ role: 'user', content: apiText }]),
          },
          success: (res) => {
            // 503（实例冷启动 / 数据库唤醒中）自动重试一次，避免“掉线”假象
            if (res.statusCode === 503 && retry > 0) {
              setTimeout(() => doChatReq(retry - 1), 1500);
              return;
            }
            const rawContent =
              res.data?.choices?.[0]?.message?.content ||
              (res.data?.error?.message
                ? friendlyError(res.data.error.message)
                : demoTextReply(text, skill, mask));
            const content = guardChatOnlyReply(rawContent, text);
            if (!res.data?.choices?.[0]?.message?.content && res.data?.error?.message) {
              reportClientError(apiBase, {
                source: 'mp-chat',
                message: res.data.error.message,
                status: res.statusCode,
                path: '/api/chat',
                detail: text.slice(0, 100),
              });
            }
            this.typeOut(aiId, content);
          },
          fail: (err) => {
            // 网络错误 / 超时（多为冷启动）自动重试一次
            if (retry > 0) {
              setTimeout(() => doChatReq(retry - 1), 1500);
              return;
            }
            reportClientError(apiBase, {
              source: 'mp-chat',
              message: (err && err.errMsg) || '网络异常',
              status: 'network',
              path: '/api/chat',
              detail: text.slice(0, 100),
            });
            this.typeOut(aiId, demoTextReply(text, skill, mask));
          },
        });
      };
      doChatReq(1);
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

  sendImage(prompt, opts) {
    const options = opts || {};
    const skipUserBubble = !!options.skipUserBubble;
    const reuseAiId = options.aiId;
    const aiId = reuseAiId || uid();
    const userMsg = { id: uid(), role: 'user', content: `🎨 ${prompt}` };

    if (reuseAiId) {
      this.updateMessage(aiId, {
        role: 'ai',
        content: '呆呆 AI 正在生成图片…',
        loading: true,
        imageConfirm: false,
        imagePromptDraft: '',
        image: '',
      });
      this.setData({
        input: '',
        canSend: false,
        busy: true,
        scrollInto: `m-${aiId}`,
      });
    } else if (skipUserBubble) {
      this.pushMessages(
        [
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
    } else {
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
    }

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
        this.setData({ busy: false }, () => {
          this.finishVisualSkillAfterDone();
          this.saveCurrentSession();
        });
      }, 600);
      return;
    }

    wx.request({
      url: `${apiBase.replace(/\/$/, '')}/api/image`,
      method: 'POST',
      timeout: 60000,
      header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
      data: { prompt, size },
      success: (res) => {
        const data = typeof res.data === 'object' && res.data ? res.data : {};
        if (res.statusCode === 429 || (data.error && data.error.code === 'QUOTA')) {
          const tip =
            (data.error && data.error.message) ||
            '今日免费生图次数已用完（2 次）';
          this.updateMessage(aiId, { loading: false, content: tip, image: '' });
          this.setData({ busy: false }, () => this.saveCurrentSession());
          return;
        }
        if (data.image) {
          this.updateMessage(aiId, {
            loading: false,
            content: imageDoneNote(prompt, 'generate'),
            image: this.absoluteImageUrl(data.image),
            imagePrompt: prompt,
            imageKind: 'generate',
          });
          this.setData({ busy: false }, () => {
            this.finishVisualSkillAfterDone();
            this.saveCurrentSession();
          });
          return;
        }
        if (data.pending && data.jobId) {
          this.updateMessage(aiId, {
            loading: true,
            content: '呆呆 AI 作图中，请稍候…',
          });
          this.pollImageJob(apiBase, data.jobId, aiId, prompt, 'generate');
          return;
        }
        const info = formatImageFail(res, data, prompt);
        reportClientError(apiBase, {
          source: 'mp-image',
          message: info.rawMsg,
          status: info.status,
          path: '/api/image',
          detail: `prompt=${prompt.slice(0, 100)};id=${info.errId}`,
        });
        this.updateMessage(aiId, {
          loading: false,
          content: info.tip,
          image: '',
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
      },
      fail: (err) => {
        const tip = [
          '无法连接生图服务',
          (err && err.errMsg) || '',
          `请检查小程序 apiBase：${apiBase || '（未配置）'}`,
          '以及 request 合法域名是否已加该域名',
        ]
          .filter(Boolean)
          .join('\n');
        reportClientError(apiBase, {
          source: 'mp-image',
          message: (err && err.errMsg) || tip,
          status: 0,
          path: '/api/image',
          detail: `apiBase=${apiBase}`,
        });
        this.updateMessage(aiId, {
          loading: false,
          content: tip,
        });
        this.setData({ busy: false });
      },
    });
  },

  pollImageJob(apiBase, jobId, aiId, prompt, kind) {
    const imageKind = kind === 'edit' ? 'edit' : 'generate';
    const base = apiBase.replace(/\/$/, '');
    const started = Date.now();
    const maxMs = 180000;
    const tick = () => {
      if (Date.now() - started > maxMs) {
        this.updateMessage(aiId, {
          loading: false,
          content: '生图等待超时。若账单已扣费，请到后台错误日志查看是否已完成。',
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
        return;
      }
      wx.request({
        url: `${base}/api/image/job/${encodeURIComponent(jobId)}`,
        method: 'GET',
        timeout: 20000,
        success: (res) => {
          const data = (res.data && res.data.job) || {};
          if (data.status === 'done' && data.image) {
            this.updateMessage(aiId, {
              loading: false,
              content: imageDoneNote(prompt, imageKind),
              image: this.absoluteImageUrl(data.image),
              imagePrompt: prompt,
              imageKind,
            });
            this.setData({ busy: false }, () => {
              this.finishVisualSkillAfterDone();
              this.saveCurrentSession();
            });
            return;
          }
          if (data.status === 'error') {
            const tip = data.error || '生图失败';
            reportClientError(apiBase, {
              source: 'mp-image-job',
              message: tip,
              status: 'job-error',
              path: '/api/image/job',
              detail: `jobId=${jobId};prompt=${String(prompt || '').slice(0, 60)}`,
            });
            this.updateMessage(aiId, { loading: false, content: tip });
            this.setData({ busy: false }, () => this.saveCurrentSession());
            return;
          }
          this.updateMessage(aiId, {
            loading: true,
            content: imageKind === 'edit' ? '呆呆 AI 改图中，请稍候…' : '呆呆 AI 作图中，请稍候…',
          });
          setTimeout(tick, 2000);
        },
        fail: () => setTimeout(tick, 2500),
      });
    };
    setTimeout(tick, 1500);
  },

  sendImageEdit(prompt, opts) {
    const options = opts || {};
    const skipUserBubble = !!options.skipUserBubble;
    const reuseAiId = options.aiId;
    const imagePath = options.imagePath || this.data.editImagePath;
    const imageB64 = options.imageB64 || this.data.editImageB64;
    const mime = options.mime || this.data.editMime || 'image/jpeg';
    const userContent = options.userContent || `🖌️ ${prompt}`;

    if (!imageB64) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      if (!skipUserBubble) this.pickEditImage();
      return;
    }

    const aiId = reuseAiId || uid();
    if (reuseAiId) {
      this.updateMessage(aiId, {
        role: 'ai',
        content: '呆呆 AI 正在改图…',
        loading: true,
        image: '',
      });
      this.setData({
        input: '',
        canSend: false,
        busy: true,
        scrollInto: `m-${aiId}`,
      });
    } else if (skipUserBubble) {
      this.pushMessages(
        [
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
    } else {
      const userMsg = {
        id: uid(),
        role: 'user',
        content: userContent,
        image: imagePath,
      };
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
    }

    const app = getApp();
    const apiBase = (app.globalData && app.globalData.apiBase) || '';
    const size = this.data.imageSize;

    if (!apiBase) {
      setTimeout(() => {
        this.updateMessage(aiId, {
          loading: false,
          content: `呆呆 AI 已收到改图需求：「${prompt.slice(0, 40)}」\n请先配置服务后再生成真实结果。`,
          image: imagePath,
        });
        this.setData({ busy: false, canSend: false }, () => {
          this.finishVisualSkillAfterDone();
          this.saveCurrentSession();
        });
      }, 700);
      return;
    }

    wx.request({
      url: `${apiBase.replace(/\/$/, '')}/api/image/edit`,
      method: 'POST',
      timeout: 60000,
      header: Object.assign({ 'content-type': 'application/json' }, authHeader()),
      data: {
        prompt,
        image_b64: imageB64,
        mime,
        size,
      },
      success: (res) => {
        const data = res.data || {};
        if (res.statusCode === 429 || (data.error && data.error.code === 'QUOTA')) {
          const tip =
            (data.error && data.error.message) ||
            '今日免费改图次数已用完（与生图合计 2 次）';
          this.updateMessage(aiId, { loading: false, content: tip, image: '' });
          this.setData({ busy: false }, () => this.saveCurrentSession());
          return;
        }
        if (data.image) {
          this.updateMessage(aiId, {
            loading: false,
            content: imageDoneNote(prompt, 'edit'),
            image: this.absoluteImageUrl(data.image),
            imagePrompt: prompt,
            imageKind: 'edit',
          });
          this.setData({ busy: false }, () => {
            this.finishVisualSkillAfterDone();
            this.saveCurrentSession();
          });
          return;
        }
        if (data.pending && data.jobId) {
          this.updateMessage(aiId, {
            loading: true,
            content: '呆呆 AI 改图中，请稍候…',
          });
          this.pollImageJob(apiBase, data.jobId, aiId, prompt, 'edit');
          return;
        }
        const rawMsg =
          (data.error && data.error.message) ||
          (typeof data.error === 'string' ? data.error : '') ||
          data.message ||
          '';
        const tip =
          friendlyError(rawMsg) ||
          `改图失败（${res.statusCode || '?'}），请到管理后台看错误日志`;
        reportClientError(apiBase, {
          source: 'mp-image-edit',
          message: rawMsg || tip,
          status: res.statusCode,
          path: '/api/image/edit',
          detail: `prompt=${String(prompt || '').slice(0, 60)}`,
        });
        this.updateMessage(aiId, {
          loading: false,
          content: tip,
          image: '',
        });
        this.setData({ busy: false }, () => this.saveCurrentSession());
      },
      fail: (err) => {
        const tip =
          friendlyError(err && err.errMsg) ||
          '无法连接服务，请检查域名与 apiBase';
        reportClientError(apiBase, {
          source: 'mp-image-edit',
          message: (err && err.errMsg) || tip,
          status: 0,
          path: '/api/image/edit',
          detail: 'wx.request fail',
        });
        this.updateMessage(aiId, {
          loading: false,
          content: tip,
        });
        this.setData({ busy: false });
      },
    });
  },
});
