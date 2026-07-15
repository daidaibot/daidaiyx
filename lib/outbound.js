/**
 * 出站请求：可选经 HTTP/HTTPS 代理池（国外出口）访问上游。
 * 环境变量：
 *   DAIDAI_HTTPS_PROXY 或 HTTPS_PROXY / HTTP_PROXY
 *   例：http://user:pass@1.2.3.4:8080
 */
const { ProxyAgent, fetch: undiciFetch } = require("undici");

const PROXY_URL = String(
  process.env.DAIDAI_HTTPS_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
).trim();

let agent = null;

function getDispatcher() {
  if (!PROXY_URL) return undefined;
  if (!agent) {
    agent = new ProxyAgent(PROXY_URL);
    console.log(`[outbound] HTTPS proxy enabled → ${maskProxy(PROXY_URL)}`);
  }
  return agent;
}

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

async function outboundFetch(url, options = {}) {
  const dispatcher = getDispatcher();
  if (dispatcher) {
    return undiciFetch(url, Object.assign({}, options, { dispatcher }));
  }
  return fetch(url, options);
}

module.exports = {
  outboundFetch,
  hasOutboundProxy: () => Boolean(PROXY_URL),
  maskProxy: () => (PROXY_URL ? maskProxy(PROXY_URL) : ""),
};
