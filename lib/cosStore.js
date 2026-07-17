/**
 * 腾讯云 COS：AI 出图可选云存储（不落本地磁盘）
 */
let COS = null;
try {
  COS = require("cos-nodejs-sdk-v5");
} catch {
  COS = null;
}

const PREFIX = String(process.env.COS_PREFIX || "gen-images").replace(/^\/+|\/+$/g, "");

function config() {
  return {
    secretId: String(process.env.COS_SECRET_ID || "").trim(),
    secretKey: String(process.env.COS_SECRET_KEY || "").trim(),
    bucket: String(process.env.COS_BUCKET || "").trim(),
    region: String(process.env.COS_REGION || "ap-shanghai").trim(),
    baseUrl: String(process.env.COS_BASE_URL || "").trim().replace(/\/$/, ""),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(COS && c.secretId && c.secretKey && c.bucket && c.region);
}

function client() {
  const c = config();
  if (!COS || !c.secretId || !c.secretKey) {
    throw new Error("COS 未配置");
  }
  return new COS({
    SecretId: c.secretId,
    SecretKey: c.secretKey,
  });
}

function objectKey(id) {
  const safe = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${PREFIX}/${safe}.jpg`;
}

function publicUrl(id) {
  const c = config();
  const key = objectKey(id);
  if (c.baseUrl) return `${c.baseUrl}/${key}`;
  return `https://${c.bucket}.cos.${c.region}.myqcloud.com/${key}`;
}

function promisify(fn, args) {
  return new Promise((resolve, reject) => {
    fn(args, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function uploadImageBuffer(id, buffer) {
  if (!isConfigured() || !id || !buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return null;
  }
  const c = config();
  const cos = client();
  const Key = objectKey(id);
  await promisify(cos.putObject.bind(cos), {
    Bucket: c.bucket,
    Region: c.region,
    Key,
    Body: buffer,
    ContentType: "image/jpeg",
  });
  return publicUrl(id);
}

async function getImageBuffer(id) {
  if (!isConfigured() || !id) return null;
  const c = config();
  const cos = client();
  const data = await promisify(cos.getObject.bind(cos), {
    Bucket: c.bucket,
    Region: c.region,
    Key: objectKey(id),
  });
  const body = data && data.Body;
  if (!body) return null;
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

module.exports = {
  isConfigured,
  config,
  uploadImageBuffer,
  getImageBuffer,
  publicUrl,
  objectKey,
};
