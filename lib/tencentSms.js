/**
 * 腾讯云短信 SendSms（TC3 签名，无额外 SDK）
 * 环境变量：
 *   TENCENT_SECRET_ID / TENCENT_SECRET_KEY
 *   或 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY
 *   SMS_SDK_APP_ID  — 短信应用 SdkAppId，如 1400xxxxxx
 *   SMS_SIGN        — 短信签名，如 呆呆网络
 *   SMS_TEMPLATE_ID — 模板 ID，内容需含验证码变量，如 {1}为您的验证码…
 */
const crypto = require("crypto");
const https = require("https");

function cfg() {
  return {
    secretId: String(
      process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID || ""
    ).trim(),
    secretKey: String(
      process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY || ""
    ).trim(),
    sdkAppId: String(process.env.SMS_SDK_APP_ID || process.env.TENCENT_SMS_SDK_APP_ID || "").trim(),
    sign: String(process.env.SMS_SIGN || process.env.TENCENT_SMS_SIGN || "").trim(),
    templateId: String(
      process.env.SMS_TEMPLATE_ID || process.env.TENCENT_SMS_TEMPLATE_ID || ""
    ).trim(),
    region: String(process.env.SMS_REGION || "ap-guangzhou").trim(),
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.secretId && c.secretKey && c.sdkAppId && c.sign && c.templateId);
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function hmacSha256(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}

function tc3Headers({ secretId, secretKey, region, service, action, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const contentType = "application/json; charset=utf-8";
  const host = `${service}.tencentcloudapi.com`;
  const hashedRequestPayload = sha256Hex(payload);
  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${host}\n` + `x-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    host,
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: host,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": "2021-01-11",
      "X-TC-Region": region,
    },
  };
}

function httpsPostJson(host, headers, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body || {});
    const req = https.request(
      {
        hostname: host,
        path: "/",
        method: "POST",
        timeout: timeoutMs,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode || 0, raw, data });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("腾讯云短信请求超时"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * @param {string} phone 11 位国内手机号
 * @param {string} code 验证码
 */
async function sendTencentSms(phone, code) {
  if (!isConfigured()) {
    const err = new Error(
      "未配置腾讯云短信（TENCENT_SECRET_ID / TENCENT_SECRET_KEY / SMS_SDK_APP_ID / SMS_SIGN / SMS_TEMPLATE_ID）"
    );
    err.code = "NO_SMS";
    throw err;
  }
  const c = cfg();
  const phoneE164 = phone.startsWith("+") ? phone : `+86${phone}`;
  const minutes = "5";
  const payloadObj = {
    PhoneNumberSet: [phoneE164],
    SmsSdkAppId: c.sdkAppId,
    SignName: c.sign,
    TemplateId: c.templateId,
    // 常见验证码模板：{1}=验证码 {2}=分钟；若只有一个变量则只传 code
    TemplateParamSet: String(process.env.SMS_TEMPLATE_PARAMS || "code,minutes")
      .split(",")
      .map((p) => (p.trim() === "minutes" ? minutes : code)),
  };
  const payload = JSON.stringify(payloadObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const { host, headers } = tc3Headers({
    secretId: c.secretId,
    secretKey: c.secretKey,
    region: c.region,
    service: "sms",
    action: "SendSms",
    payload,
    timestamp,
  });

  const result = await httpsPostJson(host, headers, payload);
  const resp = result.data || {};
  if (resp.Response && resp.Response.Error) {
    const e = resp.Response.Error;
    throw new Error(`腾讯云短信失败：${e.Code || ""} ${e.Message || result.raw}`);
  }
  const statusSet = (resp.Response && resp.Response.SendStatusSet) || [];
  const first = statusSet[0];
  if (first && String(first.Code).toUpperCase() !== "OK") {
    throw new Error(`短信发送失败：${first.Code || ""} ${first.Message || ""}`);
  }
  if (!first && result.status >= 400) {
    throw new Error(`短信发送失败 HTTP ${result.status}`);
  }
  return true;
}

module.exports = {
  isConfigured,
  sendTencentSms,
  cfg,
};
