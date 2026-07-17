const kvStore = require("./kvStore");
const db = require("./db");

const KV_SETTINGS_KEY = "admin_settings";
const KV_SECRETS_KEY = "admin_secrets";

const DEFAULT_SETTINGS = {
  maintenance: false,
  maintenanceMessage:
    "呆呆 AI 正在升级维护，暂时无法使用聊天与生图。完成后会很快恢复，请稍后再来。",
  announce: "",
  rateLimitPerMin: 120,
  blockChat: false,
  blockImage: false,
  notes: "",
  publicApiBase: "",
};

const DEFAULT_SECRETS = {
  chatKey: "",
  imageKey: "",
};

let settingsCache = null;
let secretsCache = null;
const hourly = {};
const latency = { chat: [], image: [], imageEdit: [] };
const rateBuckets = new Map();

function hourKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
}

function loadSettings() {
  if (!settingsCache) settingsCache = Object.assign({}, DEFAULT_SETTINGS);
  return Object.assign({}, settingsCache);
}

function loadSecrets() {
  if (!secretsCache) secretsCache = Object.assign({}, DEFAULT_SECRETS);
  return Object.assign({}, secretsCache);
}

async function hydrateFromDb() {
  if (!db.isReady()) return;
  try {
    const fromDb = await kvStore.getJson(KV_SETTINGS_KEY, null);
    if (fromDb && typeof fromDb === "object") {
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, fromDb);
    } else {
      settingsCache = Object.assign({}, DEFAULT_SETTINGS);
      await kvStore.setJson(KV_SETTINGS_KEY, settingsCache);
    }
  } catch (e) {
    console.error("hydrateFromDb settings failed:", e.message);
    settingsCache = Object.assign({}, DEFAULT_SETTINGS);
  }
}

async function hydrateSecretsFromDb() {
  if (!db.isReady()) return loadSecrets();
  try {
    const fromDb = await kvStore.getJson(KV_SECRETS_KEY, null);
    if (fromDb && typeof fromDb === "object") {
      secretsCache = Object.assign({}, DEFAULT_SECRETS, fromDb);
    } else {
      secretsCache = Object.assign({}, DEFAULT_SECRETS);
      await kvStore.setJson(KV_SECRETS_KEY, secretsCache);
    }
    return Object.assign({}, secretsCache);
  } catch (e) {
    console.error("hydrateSecretsFromDb failed:", e.message);
    secretsCache = Object.assign({}, DEFAULT_SECRETS);
    return loadSecrets();
  }
}

function saveSettings(partial) {
  const next = Object.assign({}, loadSettings(), partial || {});
  settingsCache = next;
  if (db.isReady()) {
    kvStore.setJson(KV_SETTINGS_KEY, next).catch((e) => {
      console.error("saveSettings db write failed:", e.message);
    });
  }
  return Object.assign({}, next);
}

function maintenanceText(settings) {
  const s = settings || loadSettings();
  const msg = String(s.maintenanceMessage || "").trim();
  return msg || DEFAULT_SETTINGS.maintenanceMessage;
}

function getPublicApiBase(settings) {
  const s = settings || loadSettings();
  const fromDb = String(s.publicApiBase || "").trim().replace(/\/$/, "");
  if (fromDb) return fromDb;
  return String(
    process.env.DAIDAI_API_BASE ||
      process.env.PUBLIC_API_BASE ||
      process.env.API_BASE ||
      ""
  )
    .trim()
    .replace(/\/$/, "");
}

function saveSecrets(partial) {
  const cur = loadSecrets();
  const next = Object.assign({}, cur);
  if (partial && typeof partial.chatKey === "string") {
    const v = partial.chatKey.trim();
    if (v) next.chatKey = v;
  }
  if (partial && typeof partial.imageKey === "string") {
    const v = partial.imageKey.trim();
    if (v) next.imageKey = v;
  }
  if (partial && partial.clearChat) next.chatKey = "";
  if (partial && partial.clearImage) next.imageKey = "";
  secretsCache = next;
  if (db.isReady()) {
    kvStore.setJson(KV_SECRETS_KEY, next).catch((e) => {
      console.error("saveSecrets db write failed:", e.message);
    });
  }
  return next;
}

function getChatKey() {
  const s = loadSecrets();
  return (
    s.chatKey ||
    process.env.DAIDAI_AI_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function getImageKey() {
  const s = loadSecrets();
  return (
    s.imageKey ||
    process.env.DAIDAI_IMAGE_KEY ||
    process.env.OPENAI_IMAGE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    s.chatKey ||
    process.env.DAIDAI_AI_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    ""
  );
}

function secretsStatus() {
  const s = loadSecrets();
  const chat = getChatKey();
  const image = getImageKey();
  return {
    chatConfigured: Boolean(chat),
    imageConfigured: Boolean(image),
    chatFromAdmin: Boolean(s.chatKey),
    imageFromAdmin: Boolean(s.imageKey),
    chatMasked: maskSecret(chat),
    imageMasked: maskSecret(image),
  };
}

function bumpHourly(field, n = 1) {
  const k = hourKey();
  if (!hourly[k]) {
    hourly[k] = { chat: 0, image: 0, imageEdit: 0, login: 0, error: 0, req: 0 };
  }
  hourly[k][field] = (hourly[k][field] || 0) + n;
  if (db.isReady()) {
    kvStore.bumpHourlyDb(field, n).catch(() => {});
  }
}

function pushLatency(kind, ms) {
  if (!latency[kind]) return;
  latency[kind].push(Number(ms) || 0);
  if (latency[kind].length > 200) latency[kind].shift();
}

function pushLog(entry) {
  bumpHourly("req", 1);
  if (entry.status >= 400) bumpHourly("error", 1);
  if (db.isReady()) {
    kvStore.appendAuditLog(entry).catch(() => {});
  }
}

function pushError(entry) {
  const row = Object.assign(
    {
      at: Date.now(),
      id: `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    },
    entry || {}
  );
  if (row.message) row.message = String(row.message).slice(0, 800);
  if (row.detail) row.detail = String(row.detail).slice(0, 500);
  bumpHourly("error", 1);
  console.error(
    "[ERROR_LOG]",
    JSON.stringify({
      id: row.id,
      source: row.source,
      status: row.status,
      path: row.path,
      message: row.message,
      detail: row.detail,
    })
  );
  if (db.isReady()) {
    kvStore.appendErrorLog(row).catch(() => {});
  }
  return row;
}

async function getLogsAsync(limit = 80) {
  if (!db.isReady()) return [];
  const rows = await kvStore.getAuditLogs(limit);
  return rows || [];
}

async function getErrorsAsync(limit = 60) {
  if (!db.isReady()) return [];
  const rows = await kvStore.getErrorLogs(limit);
  return rows || [];
}

function getLogs(limit = 80) {
  return [];
}

function getErrors(limit = 60) {
  return [];
}

async function clearLogs() {
  if (db.isReady()) {
    await kvStore.clearLogsDb();
  }
}

async function getHourlySeriesAsync(hours = 24) {
  if (db.isReady()) {
    const rows = await kvStore.getHourlySeriesDb(hours);
    if (rows && rows.length) return rows;
  }
  return getHourlySeries(hours);
}

/** 全站累计指标（登录/错误/请求），跨重启持久 */
async function getMetricTotalsAsync() {
  if (db.isReady()) {
    const totals = await kvStore.getMetricTotalsDb();
    if (totals) return totals;
  }
  return null;
}

function getHourlySeries(hours = 24) {
  const out = [];
  const now = new Date();
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600 * 1000);
    const k = hourKey(d);
    const row = hourly[k] || {
      chat: 0,
      image: 0,
      imageEdit: 0,
      login: 0,
      error: 0,
      req: 0,
    };
    out.push({
      hour: k,
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      ...row,
    });
  }
  return out;
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || req.socket.remoteAddress || "unknown";
}

function checkRateLimit(ip, limitPerMin) {
  const lim = Math.max(10, Number(limitPerMin) || 120);
  const now = Date.now();
  let arr = rateBuckets.get(ip) || [];
  arr = arr.filter((t) => now - t < 60 * 1000);
  if (arr.length >= lim) {
    rateBuckets.set(ip, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(ip, arr);
  return true;
}

function requestLogger(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/admin/") && req.path !== "/api/admin/probe") {
    return next();
  }
  const started = Date.now();
  const productPaths = new Set([
    "/api/chat",
    "/api/image",
    "/api/image/edit",
    "/api/auth/login",
    "/api/auth/web-login",
    "/api/admin/probe",
  ]);
  res.on("finish", () => {
    if (!req.path.startsWith("/api/admin/")) {
      pushLog({
        at: Date.now(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
        ip: clientIp(req),
      });
    }
    if (
      res.statusCode >= 400 &&
      productPaths.has(req.path) &&
      !(res.locals && res.locals.errorLogged)
    ) {
      pushError({
        source: String(req.path || "api").replace(/^\/api\//, "") || "api",
        message: `请求失败 HTTP ${res.statusCode}`,
        status: res.statusCode,
        path: req.path,
        detail: `method=${req.method} ms=${Date.now() - started} ip=${clientIp(req)}`,
        ip: clientIp(req),
      });
    }
  });
  next();
}

function getSystemInfo() {
  const os = require("os");
  const mem = process.memoryUsage();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    uptimeSec: Math.floor(process.uptime()),
    hostUptimeSec: Math.floor(os.uptime()),
    pid: process.pid,
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      systemUsedPct: Math.round(((total - free) / total) * 100),
      freeMb: Math.round(free / 1024 / 1024),
    },
    latencyMs: {
      chat: avg(latency.chat),
      image: avg(latency.image),
      imageEdit: avg(latency.imageEdit),
    },
    logCounts: {
      requests: 0,
      errors: 0,
    },
    storage: "mysql",
  };
}

function avg(arr) {
  if (!arr || !arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function maskSecret(v) {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  hydrateFromDb,
  hydrateSecretsFromDb,
  maintenanceText,
  getPublicApiBase,
  loadSecrets,
  saveSecrets,
  getChatKey,
  getImageKey,
  secretsStatus,
  bumpHourly,
  pushLatency,
  pushLog,
  pushError,
  getLogs,
  getLogsAsync,
  getErrors,
  getErrorsAsync,
  clearLogs,
  getHourlySeries,
  getHourlySeriesAsync,
  getMetricTotalsAsync,
  clientIp,
  checkRateLimit,
  requestLogger,
  getSystemInfo,
  maskSecret,
};
