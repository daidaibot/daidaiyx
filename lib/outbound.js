/**
 * 出站请求：支持单个代理或代理池轮询（Webshare 等）。
 *
 * 配置任选其一：
 * 1) DAIDAI_HTTPS_PROXY=http://user:pass@host:port
 * 2) DAIDAI_HTTPS_PROXIES=多行或逗号/竖线分隔的列表
 * 3) 文件 DATA_DIR/proxies.txt 或 DAIDAI_PROXY_FILE
 *    每行：host:port:user:pass  或  http://user:pass@host:port
 *
 * 失败时自动换下一个代理重试（默认最多 3 次）。
 */
const fs = require("fs");
const path = require("path");
const { ProxyAgent, fetch: undiciFetch } = require("undici");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MAX_TRIES = Math.max(1, Math.min(10, Number(process.env.DAIDAI_PROXY_TRIES) || 3));

/** @type {string[]} */
let proxyUrls = [];
let rr = 0;
/** @type {Map<string, import('undici').ProxyAgent>} */
const agents = new Map();

function maskProxy(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = u.username.slice(0, 2) + "***";
    return u.toString();
  } catch {
    return "(invalid proxy url)";
  }
}

/** host:port:user:pass → http://user:pass@host:port */
function normalizeProxyLine(line) {
  const raw = String(line || "").trim();
  if (!raw || raw.startsWith("#")) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const parts = raw.split(":");
  if (parts.length >= 4) {
    const host = parts[0];
    const port = parts[1];
    const user = parts[2];
    const pass = parts.slice(3).join(":"); // 密码里若含冒号
    if (host && port && user) {
      return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
    }
  }
  return "";
}

function splitProxyBlob(text) {
  return String(text || "")
    .split(/[\r\n,|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadProxyList() {
  const list = [];

  const single = String(
    process.env.DAIDAI_HTTPS_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      ""
  ).trim();
  if (single) {
    const n = normalizeProxyLine(single) || single;
    if (n) list.push(n);
  }

  const multi = String(process.env.DAIDAI_HTTPS_PROXIES || "").trim();
  if (multi) {
    for (const line of splitProxyBlob(multi)) {
      const n = normalizeProxyLine(line);
      if (n) list.push(n);
    }
  }

  const filePath =
    String(process.env.DAIDAI_PROXY_FILE || "").trim() ||
    path.join(DATA_DIR, "proxies.txt");
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8");
      for (const line of splitProxyBlob(text)) {
        const n = normalizeProxyLine(line);
        if (n) list.push(n);
      }
    }
  } catch (e) {
    console.error("[outbound] read proxy file failed:", e.message);
  }

  // 部署内置池：运维未粘贴时也可开箱即用（云托管从 Git 发布）
  if (!list.length) {
    const builtin = path.join(__dirname, "..", "config", "proxies.builtin.txt");
    try {
      if (fs.existsSync(builtin)) {
        const text = fs.readFileSync(builtin, "utf8");
        for (const line of splitProxyBlob(text)) {
          const n = normalizeProxyLine(line);
          if (n) list.push(n);
        }
      }
    } catch (e) {
      console.error("[outbound] read builtin proxies failed:", e.message);
    }
  }

  // 去重
  proxyUrls = Array.from(new Set(list));
  if (proxyUrls.length) {
    console.log(
      `[outbound] proxy pool loaded: ${proxyUrls.length} node(s), tries=${MAX_TRIES}, first=${maskProxy(proxyUrls[0])}`
    );
  }
  return proxyUrls;
}

function ensureLoaded() {
  if (!proxyUrls.length) loadProxyList();
  return proxyUrls;
}

function nextProxyUrl() {
  const list = ensureLoaded();
  if (!list.length) return "";
  const url = list[rr % list.length];
  rr += 1;
  return url;
}

function getAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  let ag = agents.get(proxyUrl);
  if (!ag) {
    ag = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, ag);
  }
  return ag;
}

function isRetryableProxyError(err) {
  const msg = String((err && err.message) || err || "");
  return /proxy|ECONN|ETIMEDOUT|ENOTFOUND|EHOST|socket|TLS|UND_ERR|fetch failed|network/i.test(
    msg
  );
}

async function outboundFetch(url, options = {}) {
  const list = ensureLoaded();
  if (!list.length) {
    return fetch(url, options);
  }

  let lastErr = null;
  const tries = Math.min(MAX_TRIES, list.length);
  for (let i = 0; i < tries; i++) {
    const proxyUrl = nextProxyUrl();
    const dispatcher = getAgent(proxyUrl);
    try {
      return await undiciFetch(url, Object.assign({}, options, { dispatcher }));
    } catch (err) {
      lastErr = err;
      console.warn(
        `[outbound] proxy fail (${i + 1}/${tries}) ${maskProxy(proxyUrl)} → ${err.message}`
      );
      if (!isRetryableProxyError(err) && i === 0) {
        // 非网络类也可能要换线路，继续试
      }
    }
  }
  throw lastErr || new Error("全部代理均失败");
}

module.exports = {
  outboundFetch,
  hasOutboundProxy: () => ensureLoaded().length > 0,
  maskProxy: () => {
    const list = ensureLoaded();
    if (!list.length) return "";
    return `${list.length} proxies, e.g. ${maskProxy(list[0])}`;
  },
  reloadProxies: () => {
    agents.clear();
    proxyUrls = [];
    rr = 0;
    return loadProxyList().length;
  },
  proxyCount: () => ensureLoaded().length,
};
