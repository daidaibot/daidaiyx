const fs = require("fs");
const path = require("path");
const os = require("os");
const kvStore = require("./kvStore");
const db = require("./db");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "admin-settings.json");
const SECRETS_FILE = path.join(DATA_DIR, "admin-secrets.json");
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

/** 内存缓存：保存后立即生效；落盘后重新发布也不会用代码默认值覆盖你的内容 */
let settingsCache = null;

const DEFAULT_SECRETS = {
  chatKey: "",
  imageKey: "",
};

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("ensureDataDir failed:", e.message);
  }
}

/** 仅首次写入；已有文件绝不覆盖（避免更新代码把你改过的文案冲掉） */
function seedSettingsFileIfMissing() {
  ensureDataDir();
  if (fs.existsSync(SETTINGS_FILE)) return;
  try {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(DEFAULT_SETTINGS, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("seedSettingsFileIfMissing failed:", e.message);
  }
}

function readSettingsFile() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (e) {
    console.error("readSettingsFile failed:", e.message);
    return null;
  }
}

function loadSettings() {
  if (settingsCache) return Object.assign({}, settingsCache);
  seedSettingsFileIfMissing();
  const raw = readSettingsFile();
  // 文件里已有字段以文件为准；仅补全新增字段的默认值，不覆盖你改过的文案
  settingsCache = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  return Object.assign({}, settingsCache);
}

async function hydrateFromDb() {
  if (!db.isReady()) return;
  try {
    const fromDb = await kvStore.getJson(KV_SETTINGS_KEY, null);
    if (fromDb && typeof fromDb === "object") {
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, fromDb);
      ensureDataDir();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsCache, null, 2), "utf8");
      return;
    }
    const file = loadSettings();
    await kvStore.setJson(KV_SETTINGS_KEY, file);
  } catch (e) {
    console.error("hydrateFromDb settings failed:", e.message);
  }
}

async function hydrateSecretsFromDb() {
  if (!db.isReady()) return loadSecrets();
  try {
    const fromDb = await kvStore.getJson(KV_SECRETS_KEY, null);
    if (fromDb && typeof fromDb === "object") {
      ensureDataDir();
      fs.writeFileSync(SECRETS_FILE, JSON.stringify(Object.assign({}, DEFAULT_SECRETS, fromDb), null, 2), "utf8");
      return Object.assign({}, DEFAULT_SECRETS, fromDb);
    }
    const file = loadSecrets();
    await kvStore.setJson(KV_SECRETS_KEY, file);
    return file;
  } catch (e) {
    console.error("hydrateSecretsFromDb failed:", e.message);
    return loadSecrets();
  }
}

function saveSettings(partial) {
  const next = Object.assign({}, loadSettings(), partial || {});
  settingsCache = next;
  ensureDataDir();
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch (e) {
    console.error("saveSettings disk write failed (内存已生效):", e.message);
  }
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

/** 小程序对接域名：后台设置优先，否则读云托管环境变量 */
function getPublicApiBase(settings) {
  const s = settings || loadSettings();
  const fromFile = String(s.publicApiBase || "").trim().replace(/\/$/, "");
  if (fromFile) return fromFile;
  return String(
    process.env.DAIDAI_API_BASE ||
      process.env.PUBLIC_API_BASE ||
      process.env.API_BASE ||
      ""
  )
    .trim()
    .replace(/\/$/, "");
}

function loadSecrets() {
  ensureDataDir();
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
      return Object.assign({}, DEFAULT_SECRETS, raw || {});
    }
  } catch (e) {
    console.error("loadSecrets failed:", e.message);
  }
  return Object.assign({}, DEFAULT_SECRETS);
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
  ensureDataDir();
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(next, null, 2), "utf8");
  if (db.isReady()) {
    kvStore.setJson(KV_SECRETS_KEY, next).catch((e) => {
      console.error("saveSecrets db write failed:", e.message);
    });
  }
  return next;
}

/** 对话密钥：后台配置优先，其次环境变量（对外只用呆呆命名） */
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

/** 生图密钥：后台配置优先，其次环境变量（对外只用呆呆命名） */
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

const MAX_LOGS = 300;
const MAX_ERRORS = 150;
const ERROR_LOG_FILE = path.join(DATA_DIR, "error-logs.json");
const requestLogs = [];
const errorLogs = [];
const hourly = {}; // "YYYY-MM-DDTHH" -> { chat, image, imageEdit, login, error, req }
const latency = { chat: [], image: [], imageEdit: [] };
const rateBuckets = new Map(); // ip -> timestamps[]

function hourKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
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

function avg(arr) {
  if (!arr || !arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function pushLog(entry) {
  requestLogs.unshift(entry);
  if (requestLogs.length > MAX_LOGS) requestLogs.length = MAX_LOGS;
  bumpHourly("req", 1);
  if (entry.status >= 400) bumpHourly("error", 1);
  if (db.isReady()) {
    kvStore.appendAuditLog(entry).catch(() => {});
  }
}

function loadErrorLogsFromDisk() {
  try {
    if (!fs.existsSync(ERROR_LOG_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(ERROR_LOG_FILE, "utf8"));
    if (!Array.isArray(raw)) return;
    errorLogs.length = 0;
    errorLogs.push(...raw.slice(0, MAX_ERRORS));
  } catch (e) {
    console.error("loadErrorLogsFromDisk failed:", e.message);
  }
}

function saveErrorLogsToDisk() {
  try {
    ensureDataDir();
    fs.writeFileSync(
      ERROR_LOG_FILE,
      JSON.stringify(errorLogs.slice(0, MAX_ERRORS)),
      "utf8"
    );
  } catch (e) {
    console.error("saveErrorLogsToDisk failed:", e.message);
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
  errorLogs.unshift(row);
  if (errorLogs.length > MAX_ERRORS) errorLogs.length = MAX_ERRORS;
  bumpHourly("error", 1);
  // 云托管控制台也能看到
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
  saveErrorLogsToDisk();
  if (db.isReady()) {
    kvStore.appendErrorLog(row).catch(() => {});
  }
  return row;
}

loadErrorLogsFromDisk();

function getLogs(limit = 80) {
  return requestLogs.slice(0, Math.min(limit, MAX_LOGS));
}

async function getLogsAsync(limit = 80) {
  if (db.isReady()) {
    const rows = await kvStore.getAuditLogs(limit);
    if (rows && rows.length) return rows;
  }
  return getLogs(limit);
}

function getErrors(limit = 60) {
  // 每次读取都从磁盘合并，多实例挂同一 DATA_DIR 时后台能看到别的实例写入
  try {
    if (fs.existsSync(ERROR_LOG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ERROR_LOG_FILE, "utf8"));
      if (Array.isArray(raw) && raw.length) {
        const byId = new Map();
        for (const e of errorLogs) {
          if (e && e.id) byId.set(e.id, e);
        }
        for (const e of raw) {
          if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
        }
        const merged = Array.from(byId.values()).sort(
          (a, b) => (b.at || 0) - (a.at || 0)
        );
        errorLogs.length = 0;
        errorLogs.push(...merged.slice(0, MAX_ERRORS));
      }
    }
  } catch (e) {
    console.error("getErrors merge failed:", e.message);
  }
  return errorLogs.slice(0, Math.min(limit, MAX_ERRORS));
}

async function getErrorsAsync(limit = 60) {
  if (db.isReady()) {
    const rows = await kvStore.getErrorLogs(limit);
    if (rows && rows.length) return rows;
  }
  return getErrors(limit);
}

function clearLogs() {
  requestLogs.length = 0;
  errorLogs.length = 0;
  try {
    if (fs.existsSync(ERROR_LOG_FILE)) fs.unlinkSync(ERROR_LOG_FILE);
  } catch (e) {
    console.error("clearLogs unlink errors failed:", e.message);
  }
  if (db.isReady()) {
    kvStore.clearLogsDb().catch(() => {});
  }
}

async function getHourlySeriesAsync(hours = 24) {
  if (db.isReady()) {
    const rows = await kvStore.getHourlySeriesDb(hours);
    if (rows && rows.length) return rows;
  }
  return getHourlySeries(hours);
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
    // 兜底：业务失败但业务代码没显式写错误日志时，仍记一条
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
      requests: requestLogs.length,
      errors: errorLogs.length,
    },
  };
}

function maskSecret(v) {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = {
  DATA_DIR,
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
  clientIp,
  checkRateLimit,
  requestLogger,
  getSystemInfo,
  maskSecret,
};
