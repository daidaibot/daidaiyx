/**
 * 出站请求：支持单个代理或代理池轮询（Webshare 等）。
 *
 * 配置任选其一：
 * 1) DAIDAI_HTTPS_PROXY=http://user:pass@host:port
 * 2) DAIDAI_HTTPS_PROXIES=多行或逗号/竖线分隔的列表
 * 3) 文件 DATA_DIR/proxies.txt 或 DAIDAI_PROXY_FILE
 *    每行：host:port:user:pass  或  http://user:pass@host:port
 *
 * DAIDAI_PROXY_MODE：
 *   backbone（默认）— 优先 p.webshare.io:80/1080/3128，适配云托管出站限制
 *   both — backbone + 直连 IP
 *   direct — 只用列表里的直连 IP:端口
 *
 * 失败时自动换下一个代理重试。
 */
const fs = require("fs");
const path = require("path");
const { ProxyAgent, fetch: undiciFetch } = require("undici");
const PROXIES_BUILTIN = require("./proxiesBuiltin");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MAX_TRIES = Math.max(1, Math.min(10, Number(process.env.DAIDAI_PROXY_TRIES) || 5));
const PROXY_MODE = String(process.env.DAIDAI_PROXY_MODE || "backbone").toLowerCase();

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

/**
 * Webshare 直连多用 5xxx 高端口，微信云托管出站常 ECONNRESET。
 * 同一账号可走 backbone。云托管对 1080/3128 也常超时，默认只保留 80。
 */
function deriveBackboneProxies(directUrls) {
  const seenCred = new Set();
  const out = [];
  const ports = String(process.env.DAIDAI_PROXY_PORTS || "80")
    .split(/[,|\s]+/)
    .map((p) => Number(p))
    .filter((p) => p > 0 && p < 65536);
  const usePorts = ports.length ? ports : [80];
  for (const url of directUrls) {
    try {
      const u = new URL(url);
      if (!u.username || !u.password) continue;
      const user = decodeURIComponent(u.username);
      const pass = decodeURIComponent(u.password);
      const key = `${user}\0${pass}`;
      if (seenCred.has(key)) continue;
      seenCred.add(key);
      const baseUser = user.replace(/-rotate$/i, "");
      for (const port of usePorts) {
        // rotate 优先：每次换出口 IP，提高成功率
        out.push(
          `http://${encodeURIComponent(`${baseUser}-rotate`)}:${encodeURIComponent(pass)}@p.webshare.io:${port}`
        );
        out.push(
          `http://${encodeURIComponent(baseUser)}:${encodeURIComponent(pass)}@p.webshare.io:${port}`
        );
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function applyProxyMode(list) {
  const unique = Array.from(new Set(list.filter(Boolean)));
  if (!unique.length) return [];
  const backbone = deriveBackboneProxies(unique);
  if (PROXY_MODE === "direct") return unique;
  if (PROXY_MODE === "both") return Array.from(new Set([...backbone, ...unique]));
  // backbone（默认）：有网关就只用网关，避免云托管打高端口被 RST
  return backbone.length ? backbone : unique;
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

  // 部署内置池：文件或嵌入模块（保证 Docker 只 COPY lib 也能用）
  if (!list.length) {
    const candidates = [
      path.join(__dirname, "..", "config", "proxies.builtin.txt"),
      path.join(__dirname, "proxies.builtin.txt"),
    ];
    for (const builtin of candidates) {
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
      if (list.length) break;
    }
  }
  if (!list.length && PROXIES_BUILTIN) {
    for (const line of splitProxyBlob(PROXIES_BUILTIN)) {
      const n = normalizeProxyLine(line);
      if (n) list.push(n);
    }
  }

  proxyUrls = applyProxyMode(list);
  if (proxyUrls.length) {
    console.log(
      `[outbound] proxy pool loaded: ${proxyUrls.length} node(s), mode=${PROXY_MODE}, tries=${MAX_TRIES}, first=${maskProxy(proxyUrls[0])}`
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
    // 拉长建连超时：云托管出境到 Webshare 经常超过 undici 默认 10s
    ag = new ProxyAgent({
      uri: proxyUrl,
      requestTls: { timeout: 120000 },
      proxyTls: { timeout: 120000 },
      connect: { timeout: 45000 },
    });
    agents.set(proxyUrl, ag);
  }
  return ag;
}

function isRetryableProxyError(err) {
  const msg = explainError(err);
  return /proxy|ECONN|ETIMEDOUT|ENOTFOUND|EHOST|socket|TLS|UND_ERR|fetch failed|network|认证|timeout/i.test(
    msg
  );
}

function explainError(err) {
  const parts = [];
  let e = err;
  for (let i = 0; i < 5 && e; i++) {
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(String(e.code));
    e = e.cause;
  }
  return [...new Set(parts.filter(Boolean))].join(" | ") || "网络请求失败";
}

function friendlyOutboundError(err) {
  const detail = explainError(err);
  const list = ensureLoaded();
  if (!list.length) {
    return "无法直连官方生图，且代理池未加载。请重新发布最新版本后再试";
  }
  if (/fetch failed|ECONN|ETIMEDOUT|UND_ERR|socket|Timeout/i.test(detail)) {
    return `出站代理连不上 Webshare（已试 ${Math.min(MAX_TRIES, list.length)} 条，mode=${PROXY_MODE}）。${detail.slice(0, 90)}。这不是云托管「容器端口/进站口」问题；请把后台「服务器出口 IP」加进 Webshare → Proxy Settings → IP Authorization`;
  }
  return detail.slice(0, 200);
}

async function outboundFetch(url, options = {}) {
  const list = ensureLoaded();
  if (!list.length) {
    try {
      return await undiciFetch(url, options);
    } catch (err) {
      const e = new Error(friendlyOutboundError(err));
      e.cause = err;
      throw e;
    }
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
        `[outbound] proxy fail (${i + 1}/${tries}) ${maskProxy(proxyUrl)} → ${explainError(err)}`
      );
    }
  }
  const e = new Error(friendlyOutboundError(lastErr));
  e.cause = lastErr;
  throw e;
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
  explainError,
  friendlyOutboundError,
  /** 把内置代理写入持久盘，方便后台列表可见 */
  seedProxiesToDataDir: () => {
    const dest = path.join(DATA_DIR, "proxies.txt");
    try {
      if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8").trim()) {
        return loadProxyList().length;
      }
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const fromFiles = [
        path.join(__dirname, "..", "config", "proxies.builtin.txt"),
        path.join(__dirname, "proxies.builtin.txt"),
      ];
      let text = "";
      for (const f of fromFiles) {
        if (fs.existsSync(f)) {
          text = fs.readFileSync(f, "utf8");
          break;
        }
      }
      if (!text && PROXIES_BUILTIN) text = String(PROXIES_BUILTIN);
      if (text.trim()) {
        fs.writeFileSync(dest, text, "utf8");
        console.log(`[outbound] seeded ${dest}`);
      }
    } catch (e) {
      console.error("[outbound] seed proxies failed:", e.message);
    }
    agents.clear();
    proxyUrls = [];
    rr = 0;
    return loadProxyList().length;
  },
};
