/**
 * MySQL 持久化：启动时自动建库建表；未配置 MYSQL_HOST 时降级为文件模式。
 */
const mysql = require("mysql2/promise");

let pool = null;
let ready = false;
let initError = "";

function config() {
  return {
    host: String(process.env.MYSQL_HOST || "").trim(),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: String(process.env.MYSQL_USER || process.env.MYSQL_USERNAME || "root").trim(),
    password: String(process.env.MYSQL_PASSWORD || ""),
    database: String(process.env.MYSQL_DATABASE || process.env.MYSQL_DB || "daidaiyx").trim(),
  };
}

function isConfigured() {
  return Boolean(config().host);
}

function isReady() {
  return ready && Boolean(pool);
}

function getInitError() {
  return initError;
}

async function query(sql, params) {
  if (!isReady()) throw new Error(initError || "MySQL 未就绪");
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function exec(sql, params) {
  if (!isReady()) throw new Error(initError || "MySQL 未就绪");
  const [result] = await pool.execute(sql, params);
  return result;
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
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_login_at BIGINT NOT NULL,
  UNIQUE KEY uk_users_openid (openid)
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
  error VARCHAR(512) DEFAULT '',
  ms INT DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_job_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

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
  } finally {
    await bootstrap.end();
  }
}

async function runMigrations() {
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    await pool.query(sql);
  }
  // 兼容已建库：补 quote_json 列
  try {
    await pool.query(
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
  ];
  for (const [col, def] of userCols) {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!/Duplicate column|exists/i.test(String(e && e.message))) {
        /* ignore */
      }
    }
  }
  try {
    await pool.query("CREATE INDEX idx_users_phone ON users (phone)");
  } catch (e) {
    /* ignore */
  }
  try {
    await pool.query("CREATE INDEX idx_users_email ON users (email)");
  } catch (e) {
    /* ignore */
  }
}

async function init() {
  if (!isConfigured()) {
    initError = "未配置 MYSQL_HOST";
    return false;
  }
  const cfg = config();
  try {
    await ensureDatabase();
    pool = mysql.createPool({
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
    await pool.query("SELECT 1");
    await runMigrations();
    ready = true;
    initError = "";
    console.log(`[db] MySQL ready: ${cfg.host}:${cfg.port}/${cfg.database}`);
    return true;
  } catch (err) {
    ready = false;
    initError = err.message || String(err);
    console.error("[db] MySQL init failed:", initError);
    if (pool) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      pool = null;
    }
    return false;
  }
}

module.exports = {
  init,
  isConfigured,
  isReady,
  getInitError,
  query,
  exec,
  config,
};
