const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "admin-settings.json");
const SECRETS_FILE = path.join(DATA_DIR, "admin-secrets.json");

const DEFAULT_SETTINGS = {
  maintenance: false,
  maintenanceMessage: "呆呆 AI 维护中，请稍后再试",
  announce: "",
  rateLimitPerMin: 120,
  blockChat: false,
  blockImage: false,
  notes: "",
  /** 小程序应填写的云托管域名（不含末尾斜杠） */
  publicApiBase: "",
};

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

function loadSettings() {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      return Object.assign({}, DEFAULT_SETTINGS, raw || {});
    }
  } catch (e) {
    console.error("loadSettings failed:", e.message);
  }
  return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettings(partial) {
  const next = Object.assign({}, loadSettings(), partial || {});
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
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
  return next;
}

/** 对话密钥：后台配置优先，其次环境变量 */
function getChatKey() {
  const s = loadSecrets();
  return (
    s.chatKey ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

/** 生图密钥：后台配置优先，其次环境变量 */
function getImageKey() {
  const s = loadSecrets();
  return (
    s.imageKey ||
    process.env.OPENAI_IMAGE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    s.chatKey ||
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
}

function pushError(entry) {
  errorLogs.unshift(
    Object.assign({ at: Date.now() }, entry || {})
  );
  if (errorLogs.length > MAX_ERRORS) errorLogs.length = MAX_ERRORS;
  bumpHourly("error", 1);
}

function getLogs(limit = 80) {
  return requestLogs.slice(0, Math.min(limit, MAX_LOGS));
}

function getErrors(limit = 60) {
  return errorLogs.slice(0, Math.min(limit, MAX_ERRORS));
}

function clearLogs() {
  requestLogs.length = 0;
  errorLogs.length = 0;
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
  if (req.path.startsWith("/api/admin/")) return next();
  const started = Date.now();
  res.on("finish", () => {
    pushLog({
      at: Date.now(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: clientIp(req),
    });
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
  loadSettings,
  saveSettings,
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
  getErrors,
  clearLogs,
  getHourlySeries,
  clientIp,
  checkRateLimit,
  requestLogger,
  getSystemInfo,
  maskSecret,
};
