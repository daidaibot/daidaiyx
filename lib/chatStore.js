const db = require("./db");

const MAX_SESSIONS = 40;
const MAX_MESSAGES = 120;

function titleFromMessages(messages) {
  const firstUser = (messages || []).find((m) => m.role === "user" && m.content);
  if (!firstUser) return "新对话";
  return String(firstUser.content)
    .replace(/^🎨\s*/g, "")
    .replace(/^🖌️\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20) || "新对话";
}

function previewFromMessages(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.content || m.image);
  if (!last) return "";
  if (last.image && !last.content) return "[图片]";
  return String(last.content || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function sanitizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && m.id && (m.content || m.image) && !m.loading)
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      id: String(m.id),
      role: m.role === "user" ? "user" : "ai",
      content: String(m.content || ""),
      image: String(m.image || ""),
      quote: m.quote || null,
    }));
}

async function listSessions(openid) {
  if (!db.isReady() || !openid) return [];
  const rows = await db.query(
    `SELECT id, title, preview, updated_at AS updatedAt
     FROM chat_sessions
     WHERE openid = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ?`,
    [openid, MAX_SESSIONS]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title || "对话",
    preview: r.preview || "",
    updatedAt: Number(r.updatedAt) || 0,
  }));
}

async function getSession(openid, sessionId) {
  if (!db.isReady() || !openid || !sessionId) return null;
  const rows = await db.query(
    `SELECT id, title, preview, meta_json AS metaJson, updated_at AS updatedAt, created_at AS createdAt
     FROM chat_sessions
     WHERE openid = ? AND id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [openid, sessionId]
  );
  const row = rows[0];
  if (!row) return null;
  const messages = await db.query(
    `SELECT id, role, content, image_ref AS image, quote_json AS quoteJson, sort_order AS sortOrder
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY sort_order ASC`,
    [sessionId]
  );
  let meta = {};
  try {
    meta = row.metaJson ? JSON.parse(row.metaJson) : {};
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    title: row.title || "对话",
    preview: row.preview || "",
    updatedAt: Number(row.updatedAt) || 0,
    createdAt: Number(row.createdAt) || 0,
    messages: messages.map((m) => {
      let quote = null;
      try {
        quote = m.quoteJson ? JSON.parse(m.quoteJson) : null;
      } catch {
        quote = null;
      }
      return {
        id: m.id,
        role: m.role === "user" ? "user" : "ai",
        content: m.content || "",
        image: m.image || "",
        quote,
      };
    }),
    meta,
  };
}

async function saveSession(openid, payload) {
  if (!db.isReady() || !openid || !payload || !payload.id) return null;
  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) return listSessions(openid);

  const ts = Date.now();
  const title = payload.title || titleFromMessages(messages);
  const preview = payload.preview || previewFromMessages(messages);
  const meta = payload.meta || {};
  const sessionId = String(payload.id);

  const exist = await db.query(
    "SELECT created_at FROM chat_sessions WHERE id = ? AND openid = ? LIMIT 1",
    [sessionId, openid]
  );
  const createdAt = exist[0] ? Number(exist[0].created_at) : ts;

  await db.exec(
    `INSERT INTO chat_sessions (id, openid, title, preview, meta_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       preview = VALUES(preview),
       meta_json = VALUES(meta_json),
       updated_at = VALUES(updated_at),
       deleted_at = NULL`,
    [sessionId, openid, title, preview, JSON.stringify(meta), createdAt, ts]
  );

  await db.exec("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    await db.exec(
      `INSERT INTO chat_messages (id, session_id, role, content, image_ref, quote_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id,
        sessionId,
        m.role,
        m.content,
        m.image,
        m.quote ? JSON.stringify(m.quote) : null,
        i,
        ts,
      ]
    );
  }

  // 只保留最近 N 个会话
  const all = await listSessions(openid);
  if (all.length > MAX_SESSIONS) {
    const drop = all.slice(MAX_SESSIONS);
    for (const s of drop) {
      await removeSession(openid, s.id);
    }
  }
  return listSessions(openid);
}

async function removeSession(openid, sessionId) {
  if (!db.isReady() || !openid || !sessionId) return [];
  const ts = Date.now();
  await db.exec(
    "UPDATE chat_sessions SET deleted_at = ? WHERE openid = ? AND id = ?",
    [ts, openid, sessionId]
  );
  await db.exec("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  return listSessions(openid);
}

async function clearSessions(openid) {
  if (!db.isReady() || !openid) return [];
  const rows = await db.query(
    "SELECT id FROM chat_sessions WHERE openid = ? AND deleted_at IS NULL",
    [openid]
  );
  for (const row of rows) {
    await removeSession(openid, row.id);
  }
  return [];
}

module.exports = {
  listSessions,
  getSession,
  saveSession,
  removeSession,
  clearSessions,
  sanitizeMessages,
  titleFromMessages,
  previewFromMessages,
};
