/**
 * 用户日用量：对话统计 + 生图/改图配额（仅 MySQL）
 * 普通用户每天合计 2 次生图+改图；会员不限
 */
const ops = require("./ops");
const db = require("./db");
const authStore = require("./authStore");

const FREE_IMAGE_DAILY = 2;

function requireDb() {
  if (!db.isReady()) {
    const err = new Error(db.getInitError() || "数据库未就绪");
    err.code = "DB";
    throw err;
  }
}

function todayKey(ts = Date.now()) {
  const d = new Date(ts + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function emptyRow(openid, usageDate) {
  return {
    openid,
    usageDate,
    chatOk: 0,
    chatFail: 0,
    imageOk: 0,
    imageFail: 0,
    imageEditOk: 0,
    imageEditFail: 0,
    imageUsed: 0,
  };
}

function mapRow(r) {
  return {
    openid: r.openid,
    usageDate: r.usageDate,
    chatOk: Number(r.chatOk) || 0,
    chatFail: Number(r.chatFail) || 0,
    imageOk: Number(r.imageOk) || 0,
    imageFail: Number(r.imageFail) || 0,
    imageEditOk: Number(r.imageEditOk) || 0,
    imageEditFail: Number(r.imageEditFail) || 0,
    imageUsed: Number(r.imageUsed) || 0,
  };
}

async function getRow(openid, usageDate) {
  requireDb();
  const oid = String(openid || "").trim();
  const day = usageDate || todayKey();
  if (!oid) return emptyRow("", day);

  const rows = await db.query(
    `SELECT openid, usage_date AS usageDate,
            chat_ok AS chatOk, chat_fail AS chatFail,
            image_ok AS imageOk, image_fail AS imageFail,
            image_edit_ok AS imageEditOk, image_edit_fail AS imageEditFail,
            image_used AS imageUsed
     FROM user_daily_usage WHERE openid = ? AND usage_date = ? LIMIT 1`,
    [oid, day]
  );
  if (rows[0]) return mapRow(rows[0]);
  return emptyRow(oid, day);
}

async function ensureMysqlRow(openid, day) {
  await db.exec(
    `INSERT INTO user_daily_usage
      (openid, usage_date, chat_ok, chat_fail, image_ok, image_fail, image_edit_ok, image_edit_fail, image_used)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE openid = openid`,
    [openid, day]
  );
}

async function bump(openid, field, delta = 1) {
  requireDb();
  const oid = String(openid || "").trim();
  if (!oid || !field) return;
  const day = todayKey();
  const colMap = {
    chatOk: "chat_ok",
    chatFail: "chat_fail",
    imageOk: "image_ok",
    imageFail: "image_fail",
    imageEditOk: "image_edit_ok",
    imageEditFail: "image_edit_fail",
    imageUsed: "image_used",
  };
  const col = colMap[field];
  if (!col) return;
  await ensureMysqlRow(oid, day);
  await db.exec(
    `UPDATE user_daily_usage SET ${col} = GREATEST(0, ${col} + ?) WHERE openid = ? AND usage_date = ?`,
    [delta, oid, day]
  );
}

async function tryConsumeImageQuota(openid) {
  const oid = String(openid || "").trim();
  if (!oid) {
    const err = new Error("请先登录");
    err.code = "AUTH";
    throw err;
  }
  if (await authStore.isMember(oid)) {
    return { ok: true, unlimited: true, used: 0, limit: null };
  }
  const day = todayKey();
  const row = await getRow(oid, day);
  const used = Number(row.imageUsed || 0);
  if (used >= FREE_IMAGE_DAILY) {
    const err = new Error(`今日免费生图/改图次数已用完（${FREE_IMAGE_DAILY} 次），会员不限次数`);
    err.code = "QUOTA";
    err.used = used;
    err.limit = FREE_IMAGE_DAILY;
    throw err;
  }
  await bump(oid, "imageUsed", 1);
  return { ok: true, unlimited: false, used: used + 1, limit: FREE_IMAGE_DAILY };
}

/** 只检查额度，不扣次（扣次改到生图/改图成功之后，避免任务挂掉导致「用了但没成功」） */
async function assertImageQuota(openid) {
  const oid = String(openid || "").trim();
  if (!oid) {
    const err = new Error("请先登录");
    err.code = "AUTH";
    throw err;
  }
  if (await authStore.isMember(oid)) {
    return { ok: true, unlimited: true, used: 0, limit: null, remaining: null };
  }
  const day = todayKey();
  const row = await getRow(oid, day);
  const used = Number(row.imageUsed || 0);
  if (used >= FREE_IMAGE_DAILY) {
    const err = new Error(`今日免费生图/改图次数已用完（${FREE_IMAGE_DAILY} 次），会员不限次数`);
    err.code = "QUOTA";
    err.used = used;
    err.limit = FREE_IMAGE_DAILY;
    throw err;
  }
  return {
    ok: true,
    unlimited: false,
    used,
    limit: FREE_IMAGE_DAILY,
    remaining: Math.max(0, FREE_IMAGE_DAILY - used),
  };
}

async function refundImageQuota(openid) {
  if (await authStore.isMember(openid)) return;
  await bump(openid, "imageUsed", -1);
}

async function recordChat(openid, ok) {
  await bump(openid, ok ? "chatOk" : "chatFail", 1);
}

/**
 * @param {boolean} ok
 * @param {{ refundQuota?: boolean }} [opts] 仅当「先扣额度后失败」时才 refundQuota=true
 */
async function recordImage(openid, kind, ok, opts = {}) {
  const edit = kind === "edit";
  if (ok) await bump(openid, edit ? "imageEditOk" : "imageOk", 1);
  else {
    await bump(openid, edit ? "imageEditFail" : "imageFail", 1);
    if (opts.refundQuota) await refundImageQuota(openid);
  }
}

/** 全站累计用量（跨重启持久，用于后台总览） */
async function getTotals() {
  requireDb();
  const [usageRows, imageRows, jobRows] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(chat_ok), 0) AS chatOk,
         COALESCE(SUM(chat_fail), 0) AS chatFail,
         COALESCE(SUM(image_ok), 0) AS imageOk,
         COALESCE(SUM(image_fail), 0) AS imageFail,
         COALESCE(SUM(image_edit_ok), 0) AS imageEditOk,
         COALESCE(SUM(image_edit_fail), 0) AS imageEditFail
       FROM user_daily_usage`
    ),
    db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'edit' THEN 1 ELSE 0 END), 0) AS editCount,
         COALESCE(SUM(CASE WHEN kind <> 'edit' THEN 1 ELSE 0 END), 0) AS genCount
       FROM images`
    ),
    db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'done' AND kind = 'edit' THEN 1 ELSE 0 END), 0) AS editDone,
         COALESCE(SUM(CASE WHEN status = 'done' AND kind <> 'edit' THEN 1 ELSE 0 END), 0) AS genDone
       FROM image_jobs`
    ),
  ]);
  const u = usageRows[0] || {};
  const img = imageRows[0] || {};
  const job = jobRows[0] || {};
  const imageOk = Math.max(
    Number(u.imageOk) || 0,
    Number(img.genCount) || 0,
    Number(job.genDone) || 0
  );
  const imageEditOk = Math.max(
    Number(u.imageEditOk) || 0,
    Number(img.editCount) || 0,
    Number(job.editDone) || 0
  );
  return {
    chat: Number(u.chatOk) || 0,
    chatFail: Number(u.chatFail) || 0,
    image: imageOk,
    imageFail: Number(u.imageFail) || 0,
    imageEdit: imageEditOk,
    imageEditFail: Number(u.imageEditFail) || 0,
    imageTotal: imageOk + imageEditOk,
  };
}

async function getUserStats(openid, days = 7) {
  requireDb();
  const oid = String(openid || "").trim();
  const n = Math.max(1, Math.min(31, Number(days) || 7));
  const today = todayKey();
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.push(todayKey(Date.now() - i * 86400000));
  }

  const rows = await db.query(
    `SELECT openid, usage_date AS usageDate,
            chat_ok AS chatOk, chat_fail AS chatFail,
            image_ok AS imageOk, image_fail AS imageFail,
            image_edit_ok AS imageEditOk, image_edit_fail AS imageEditFail,
            image_used AS imageUsed
     FROM user_daily_usage
     WHERE openid = ? AND usage_date IN (${keys.map(() => "?").join(",")})
     ORDER BY usage_date DESC`,
    [oid, ...keys]
  );
  const byDay = {};
  rows.forEach((r) => {
    byDay[r.usageDate] = mapRow(r);
  });
  const daily = keys.map((d) => byDay[d] || emptyRow(oid, d));
  const todayRow = byDay[today] || emptyRow(oid, today);
  const member = await authStore.isMember(oid);
  return {
    openid: oid,
    isMember: member,
    today: todayRow,
    daily,
    imageQuota: member
      ? { unlimited: true, used: todayRow.imageUsed, limit: null }
      : {
          unlimited: false,
          used: todayRow.imageUsed,
          limit: FREE_IMAGE_DAILY,
          remaining: Math.max(0, FREE_IMAGE_DAILY - todayRow.imageUsed),
        },
  };
}

async function listTodayUsage(limit = 100) {
  requireDb();
  const day = todayKey();
  const lim = Math.max(1, Math.min(200, Number(limit) || 100));
  const rows = await db.query(
    `SELECT openid, usage_date AS usageDate,
            chat_ok AS chatOk, chat_fail AS chatFail,
            image_ok AS imageOk, image_fail AS imageFail,
            image_edit_ok AS imageEditOk, image_edit_fail AS imageEditFail,
            image_used AS imageUsed
     FROM user_daily_usage
     WHERE usage_date = ?
     ORDER BY (chat_ok + chat_fail + image_used) DESC
     LIMIT ?`,
    [day, lim]
  );
  return rows.map(mapRow);
}

async function buildAlerts() {
  const day = todayKey();
  const todayList = await listTodayUsage(200);
  const alerts = [];

  todayList.forEach((u) => {
    const imgFail = (u.imageFail || 0) + (u.imageEditFail || 0);
    const chatTotal = (u.chatOk || 0) + (u.chatFail || 0);
    if ((u.imageUsed || 0) >= FREE_IMAGE_DAILY) {
      alerts.push({
        level: "warn",
        type: "quota",
        openid: u.openid,
        message: `今日生图额度已用尽（${u.imageUsed}/${FREE_IMAGE_DAILY}）`,
        at: Date.now(),
      });
    }
    if (imgFail >= 3) {
      alerts.push({
        level: "bad",
        type: "image_fail",
        openid: u.openid,
        message: `今日生图/改图失败 ${imgFail} 次`,
        at: Date.now(),
      });
    }
    if (chatTotal >= 80) {
      alerts.push({
        level: "warn",
        type: "chat_high",
        openid: u.openid,
        message: `今日对话请求偏高（${chatTotal} 次）`,
        at: Date.now(),
      });
    }
  });

  try {
    const errors = typeof ops.getErrorsAsync === "function" ? await ops.getErrorsAsync(40) : [];
    const recentImg = (errors || []).filter(
      (e) =>
        e &&
        /image/i.test(String(e.source || "")) &&
        Date.now() - Number(e.at || 0) < 6 * 3600 * 1000
    );
    if (recentImg.length >= 8) {
      alerts.push({
        level: "bad",
        type: "global_image_fail",
        openid: "",
        message: `近 6 小时生图相关错误 ${recentImg.length} 条，请检查密钥/上游`,
        at: Date.now(),
      });
    }
  } catch {
    /* ignore */
  }

  alerts.sort((a, b) => {
    const rank = { bad: 0, warn: 1, info: 2 };
    return (rank[a.level] || 9) - (rank[b.level] || 9);
  });

  return { ok: true, date: day, alerts, freeImageDaily: FREE_IMAGE_DAILY };
}

module.exports = {
  FREE_IMAGE_DAILY,
  todayKey,
  getRow,
  getTotals,
  getUserStats,
  listTodayUsage,
  tryConsumeImageQuota,
  assertImageQuota,
  refundImageQuota,
  recordChat,
  recordImage,
  buildAlerts,
};
