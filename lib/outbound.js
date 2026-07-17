/**
 * 出站 HTTP：直连上游（VPS / 自建中转），不再使用代理池。
 */
const { fetch: undiciFetch } = require("undici");

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

async function outboundFetch(url, options = {}) {
  try {
    return await undiciFetch(url, options);
  } catch (err) {
    const e = new Error(
      `直连上游失败：${explainError(err).slice(0, 160)}（目标 ${String(url).slice(0, 80)}）`
    );
    e.cause = err;
    throw e;
  }
}

module.exports = {
  outboundFetch,
  explainError,
};
