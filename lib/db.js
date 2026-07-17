/**
 * MySQL 持久化：启动时自动建库建表。
 * 用户/小程序业务数据仅存数据库，不落本地文件。
 *
 * 连接方式对齐官方模板 wxcloudrun-express（db.js）：
 *   环境变量只读 MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD
 *   库名代码内写死 nodejs_demo（控制台不提供库名）
 *
 * 文档：
 *   https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/weixin/index
 *   https://github.com/WeixinCloud/wxcloudrun-express
 *
 * 官方 FAQ：Serverless 自动暂停后连接可能报
 * “CynosDB serverless instance is resuming”，需重试。
 */
const mysql = require("mysql2/promise");

let pool = null;
let ready = false;
let initError = "";

const RESUME_RE =
  /resuming|please try connecting again|CynosDB serverless instance is resuming/i;

/** 官方 Express 模板硬编码库名，见 wxcloudrun-express/db.js */
const DATABASE_NAME = "nodejs_demo";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 与官方一致：
 *   const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;
 *   const [host, port] = MYSQL_ADDRESS.split(":");
 *   sequelize = new Sequelize("nodejs_demo", MYSQL_USERNAME, MYSQL_PASSWORD, { host, port, ... })
 */
function config() {
  const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;
  const address = String(MYSQL_ADDRESS || "").trim();
  const [hostPart, portPart] = address.split(":");
  const host = String(hostPart || "").trim();
  const port = Number(portPart) || 3306;
  return {
    host,
    port,
    user: MYSQL_USERNAME,
    password: MYSQL_PASSWORD,
    database: DATABASE_NAME,
  };
}

function isConfigured() {
  const { MYSQL_ADDRESS, MYSQL_USERNAME, MYSQL_PASSWORD } = process.env;
  return Boolean(
    String(MYSQL_ADDRESS || "").trim() &&
      String(MYSQL_USERNAME || "").length &&
      String(MYSQL_PASSWORD || "").length
  );
}

function isReady() {
  return ready && Boolean(pool);
}

function getInitError() {
  return initError;
}

function getConfigSource() {
  return isConfigured() ? "MYSQL_ADDRESS" : "";
}

async function withResumeRetry(fn, label = "query") {
  const maxTries = 5;
  let lastErr = null;
  for (let i = 0; i < maxTries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      if (RESUME_RE.test(msg) && i < maxTries - 1) {
        const wait = 1500 + i * 1500;
        console.warn(`[db] ${label} 冷启动中，${wait}ms 后重试 (${i + 1}/${maxTries})…`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function query(sql, params) {
  if (!isReady()) throw new Error(initError || "MySQL 未就绪");
  return withResumeRetry(async () => {
    const [rows] = await pool.query(sql, params);
    return rows;
  }, "query");
}

async function exec(sql, params) {
  if (!isReady()) throw new Error(initError || "MySQL 未就绪");
  return withResumeRetry(async () => {
    const [result] = await pool.execute(sql, params);
    return result;
  }, "exec");
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64) DEFAULT '',
  platform VARCHAR(16) NOT NULL DEFAULT 'wechat',
  nick_name VARCHAR(64) DEFAULT '',
  avatar_url VARCHAR(512) DEFAULT '',
  phone VARCHAR(20) DEFAULT '',
  email VARCHAR(128) DEFAULT '',
  password_hash VARCHAR(128) DEFAULT '',
  is_member TINYINT(1) NOT NULL DEFAULT 0,
  is_banned TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_login_at BIGINT NOT NULL,
  UNIQUE KEY uk_users_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_daily_usage (
  openid VARCHAR(64) NOT NULL,
  usage_date CHAR(8) NOT NULL,
  chat_ok INT NOT NULL DEFAULT 0,
  chat_fail INT NOT NULL DEFAULT 0,
  image_ok INT NOT NULL DEFAULT 0,
  image_fail INT NOT NULL DEFAULT 0,
  image_edit_ok INT NOT NULL DEFAULT 0,
  image_edit_fail INT NOT NULL DEFAULT 0,
  image_used INT NOT NULL DEFAULT 0,
  PRIMARY KEY (openid, usage_date),
  KEY idx_usage_date (usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL,
  user_id BIGINT NULL,
  openid VARCHAR(64) DEFAULT '',
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  ip VARCHAR(45) DEFAULT '',
  UNIQUE KEY uk_auth_token (token_hash),
  KEY idx_auth_openid (openid),
  KEY idx_auth_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id VARCHAR(64) PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  title VARCHAR(128) DEFAULT '',
  preview VARCHAR(256) DEFAULT '',
  meta_json MEDIUMTEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT NULL,
  KEY idx_chat_sess_openid (openid, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT,
  image_ref VARCHAR(512) DEFAULT '',
  quote_json MEDIUMTEXT,
  sort_order INT NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_chat_msg_session (session_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS kv_store (
  k VARCHAR(64) PRIMARY KEY,
  v MEDIUMTEXT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  at BIGINT NOT NULL,
  method VARCHAR(8) DEFAULT '',
  path VARCHAR(128) DEFAULT '',
  status SMALLINT DEFAULT 0,
  ms INT DEFAULT 0,
  ip VARCHAR(45) DEFAULT '',
  openid VARCHAR(64) DEFAULT '',
  KEY idx_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS error_logs (
  id VARCHAR(32) PRIMARY KEY,
  at BIGINT NOT NULL,
  source VARCHAR(32) DEFAULT '',
  message VARCHAR(800) DEFAULT '',
  status SMALLINT DEFAULT 0,
  path VARCHAR(128) DEFAULT '',
  detail VARCHAR(500) DEFAULT '',
  ip VARCHAR(45) DEFAULT '',
  KEY idx_error_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hourly_metrics (
  hour_key CHAR(13) PRIMARY KEY,
  chat INT DEFAULT 0,
  image INT DEFAULT 0,
  image_edit INT DEFAULT 0,
  login INT DEFAULT 0,
  error INT DEFAULT 0,
  req INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS images (
  id VARCHAR(64) PRIMARY KEY,
  openid VARCHAR(64) DEFAULT '',
  job_id VARCHAR(64) DEFAULT '',
  kind VARCHAR(16) NOT NULL DEFAULT 'generate',
  prompt TEXT,
  size VARCHAR(16) DEFAULT '',
  file_path VARCHAR(256) DEFAULT '',
  bytes INT DEFAULT 0,
  watermarked TINYINT(1) DEFAULT 0,
  public_url VARCHAR(512) DEFAULT '',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NULL,
  KEY idx_images_openid (openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS image_jobs (
  id VARCHAR(64) PRIMARY KEY,
  openid VARCHAR(64) DEFAULT '',
  status VARCHAR(16) NOT NULL,
  kind VARCHAR(16) DEFAULT 'generate',
  prompt VARCHAR(200) DEFAULT '',
  size VARCHAR(16) DEFAULT '',
  image_id VARCHAR(64) DEFAULT '',
  image_ref MEDIUMTEXT,
  error VARCHAR(512) DEFAULT '',
  ms INT DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_job_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS otp_codes (
  account_key VARCHAR(160) PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  expire_at BIGINT NOT NULL,
  sent_at BIGINT NOT NULL,
  ip VARCHAR(45) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_masks (
  id VARCHAR(64) NOT NULL,
  openid VARCHAR(64) NOT NULL,
  name VARCHAR(64) DEFAULT '',
  emoji VARCHAR(16) DEFAULT '🎭',
  description VARCHAR(128) DEFAULT '',
  prompt TEXT,
  hello VARCHAR(512) DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (openid, id),
  KEY idx_masks_openid (openid, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blobs (
  id VARCHAR(80) PRIMARY KEY,
  kind VARCHAR(16) NOT NULL DEFAULT 'file',
  mime VARCHAR(64) NOT NULL DEFAULT 'application/octet-stream',
  data LONGBLOB NOT NULL,
  bytes INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NULL,
  KEY idx_blobs_kind_created (kind, created_at),
  KEY idx_blobs_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * 尝试建库。业务账号可能无 CREATE 权限（云托管新建账号常见），失败时不阻断，
 * 要求库已在「数据库管理」里建好，或用 root。
 */
async function ensureDatabase() {
  const cfg = config();
  const bootstrap = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true,
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (/Access denied|CREATE command denied/i.test(msg)) {
      console.warn(
        `[db] 当前账号无建库权限，跳过 CREATE DATABASE（请确认库 ${cfg.database} 已存在）：${msg}`
      );
    } else if (RESUME_RE.test(msg)) {
      throw err;
    } else {
      console.warn(`[db] CREATE DATABASE 失败，将尝试直连已有库：${msg}`);
    }
  } finally {
    await bootstrap.end();
  }
}

async function runMigrations(activePool) {
  const p = activePool || pool;
  if (!p) throw new Error("MySQL pool 未就绪，无法迁移");
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    await p.query(sql);
  }
  try {
    await p.query(
      "ALTER TABLE chat_messages ADD COLUMN quote_json MEDIUMTEXT NULL AFTER image_ref"
    );
  } catch (e) {
    if (!/Duplicate column|exists/i.test(String(e && e.message))) {
      /* ignore */
    }
  }
  const userCols = [
    ["phone", "VARCHAR(20) DEFAULT ''"],
    ["email", "VARCHAR(128) DEFAULT ''"],
    ["password_hash", "VARCHAR(128) DEFAULT ''"],
    ["is_member", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["is_banned", "TINYINT(1) NOT NULL DEFAULT 0"],
  ];
  for (const [col, def] of userCols) {
    try {
      await p.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!/Duplicate column|exists/i.test(String(e && e.message))) {
        /* ignore */
      }
    }
  }
  try {
    await p.query("CREATE INDEX idx_users_phone ON users (phone)");
  } catch (e) {
    /* ignore */
  }
  try {
    await p.query("CREATE INDEX idx_users_email ON users (email)");
  } catch (e) {
    /* ignore */
  }
  try {
    await p.query(
      "ALTER TABLE image_jobs ADD COLUMN image_ref MEDIUMTEXT NULL AFTER image_id"
    );
  } catch (e) {
    if (!/Duplicate column|exists/i.test(String(e && e.message))) {
      /* ignore */
    }
  }
}

async function connectOnce() {
  const cfg = config();
  await ensureDatabase();
  const nextPool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 8,
    charset: "utf8mb4",
    timezone: "+00:00",
  });
  await nextPool.query("SELECT 1");
  await runMigrations(nextPool);
  return nextPool;
}

async function init() {
  if (!isConfigured()) {
    initError =
      "未配置 MySQL：请按官方要求填写 MYSQL_ADDRESS、MYSQL_USERNAME、MYSQL_PASSWORD";
    return false;
  }

  const cfg = config();
  const maxTries = 5;
  let lastErr = null;

  for (let i = 0; i < maxTries; i++) {
    try {
      if (pool) {
        try {
          await pool.end();
        } catch {
          /* ignore */
        }
        pool = null;
      }
      pool = await withResumeRetry(() => connectOnce(), "init");
      ready = true;
      initError = "";
      console.log(
        `[db] MySQL ready: ${cfg.host}:${cfg.port}/${cfg.database} user=${cfg.user}`
      );
      return true;
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      initError = msg;
      ready = false;
      if (RESUME_RE.test(msg) && i < maxTries - 1) {
        const wait = 2000 + i * 1500;
        console.warn(`[db] MySQL 冷启动中，${wait}ms 后重试 (${i + 1}/${maxTries})…`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  if (pool) {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    pool = null;
  }
  ready = false;
  initError = (lastErr && lastErr.message) || String(lastErr || "MySQL 连接失败");
  console.error("[db] MySQL init failed:", initError);
  return false;
}

module.exports = {
  init,
  isConfigured,
  isReady,
  getInitError,
  getConfigSource,
  query,
  exec,
  config,
};
