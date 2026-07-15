const INDEX_KEY = 'daidai_chat_index';
const MAX_SESSIONS = 40;
const MAX_MESSAGES = 120;

function storageKey(openid) {
  return openid ? `${INDEX_KEY}_${openid}` : INDEX_KEY;
}

function sessionKey(openid, id) {
  return openid ? `daidai_sess_${openid}_${id}` : `daidai_sess_${id}`;
}

function getOpenId() {
  try {
    const user = wx.getStorageSync('daidai_user');
    return (user && user.openid) || '';
  } catch (e) {
    return '';
  }
}

function loadIndex(openid) {
  const oid = openid || getOpenId();
  try {
    const list = wx.getStorageSync(storageKey(oid));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveIndex(list, openid) {
  const oid = openid || getOpenId();
  wx.setStorageSync(storageKey(oid), (list || []).slice(0, MAX_SESSIONS));
}

/** 把过大的 dataURL 落到本地文件，避免撑爆 Storage */
function persistImageField(msg) {
  if (!msg || !msg.image) return msg;
  const src = String(msg.image);
  if (!src.startsWith('data:image')) return msg;

  try {
    const m = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return { ...msg, image: '', content: (msg.content || '') + '\n（图片过大，已省略）' };
    const ext = m[1].includes('jpeg') || m[1].includes('jpg') ? 'jpg' : 'png';
    const filePath = `${wx.env.USER_DATA_PATH}/daidai_${msg.id || Date.now()}.${ext}`;
    wx.getFileSystemManager().writeFileSync(filePath, m[2], 'base64');
    return { ...msg, image: filePath };
  } catch (e) {
    return {
      ...msg,
      image: '',
      content: (msg.content || '') + '\n（图片保存失败）',
    };
  }
}

function sanitizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && m.id && (m.content || m.image) && !m.loading)
    .slice(-MAX_MESSAGES)
    .map((m) =>
      persistImageField({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'ai',
        content: m.content || '',
        image: m.image || '',
      })
    );
}

function titleFromMessages(messages) {
  const firstUser = (messages || []).find((m) => m.role === 'user' && m.content);
  if (!firstUser) return '新对话';
  return String(firstUser.content)
    .replace(/^🎨\s*/g, '')
    .replace(/^🖌️\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20) || '新对话';
}

function previewFromMessages(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.content || m.image);
  if (!last) return '';
  if (last.image && !last.content) return '[图片]';
  return String(last.content || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * 保存完整会话（索引 + 消息体）
 * payload: { id, messages, meta }
 */
function saveSession(payload, openid) {
  const oid = openid || getOpenId();
  if (!payload || !payload.id) return loadIndex(oid);

  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) {
    // 空会话不入库
    return loadIndex(oid);
  }

  const title = payload.title || titleFromMessages(messages);
  const preview = payload.preview || previewFromMessages(messages);
  const updatedAt = Date.now();
  const body = {
    id: payload.id,
    title,
    preview,
    updatedAt,
    messages,
    meta: {
      activeSkill: (payload.meta && payload.meta.activeSkill) || '',
      skillLabel: (payload.meta && payload.meta.skillLabel) || '',
      activeMask: (payload.meta && payload.meta.activeMask) || '',
      maskLabel: (payload.meta && payload.meta.maskLabel) || '',
      maskPrompt: (payload.meta && payload.meta.maskPrompt) || '',
      welcomeEmoji: (payload.meta && payload.meta.welcomeEmoji) || '呆',
      navSub: (payload.meta && payload.meta.navSub) || '随时帮忙',
      imageSize: (payload.meta && payload.meta.imageSize) || '1024x1024',
    },
  };

  try {
    wx.setStorageSync(sessionKey(oid, payload.id), body);
  } catch (e) {
    // 容量不够时再砍消息重试
    try {
      body.messages = body.messages.slice(-40).map((m) => ({
        ...m,
        image: m.image && String(m.image).startsWith('data:') ? '' : m.image,
      }));
      wx.setStorageSync(sessionKey(oid, payload.id), body);
    } catch (err) {
      console.warn('saveSession failed', err);
      return loadIndex(oid);
    }
  }

  const list = loadIndex(oid).filter((s) => s.id !== payload.id);
  list.unshift({
    id: payload.id,
    title: body.title,
    preview: body.preview,
    updatedAt,
  });
  saveIndex(list, oid);
  return list;
}

function getSession(id, openid) {
  const oid = openid || getOpenId();
  if (!id) return null;
  try {
    const raw = wx.getStorageSync(sessionKey(oid, id));
    if (!raw || !raw.id) return null;
    return {
      id: raw.id,
      title: raw.title || '对话',
      preview: raw.preview || '',
      updatedAt: raw.updatedAt || 0,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      meta: raw.meta || {},
    };
  } catch (e) {
    return null;
  }
}

function removeSession(id, openid) {
  const oid = openid || getOpenId();
  try {
    wx.removeStorageSync(sessionKey(oid, id));
  } catch (e) {
    /* ignore */
  }
  const list = loadIndex(oid).filter((s) => s.id !== id);
  saveIndex(list, oid);
  return list;
}

function clearHistory(openid) {
  const oid = openid || getOpenId();
  const list = loadIndex(oid);
  list.forEach((s) => {
    try {
      wx.removeStorageSync(sessionKey(oid, s.id));
    } catch (e) {
      /* ignore */
    }
  });
  saveIndex([], oid);
}

/** 兼容旧版只用摘要的列表 */
function loadHistory(openid) {
  return loadIndex(openid);
}

function upsertSession(session, openid) {
  // 兼容旧调用：若只传摘要，尽量补全已有消息体
  const oid = openid || getOpenId();
  if (!session || !session.id) return loadIndex(oid);
  const exist = getSession(session.id, oid);
  return saveSession(
    {
      id: session.id,
      title: session.title,
      preview: session.preview,
      messages: (exist && exist.messages) || [],
      meta: (exist && exist.meta) || {},
    },
    oid
  );
}

module.exports = {
  loadHistory,
  loadIndex,
  saveSession,
  getSession,
  removeSession,
  clearHistory,
  upsertSession,
  titleFromMessages,
  previewFromMessages,
};
