/**
 * 腾讯云 COS：AI 出图持久化。未配置 COS_BUCKET 时自动跳过，仍走本地 data/gen-images。
 */
const fs = require("fs");
const path = require("path");

let COS = null;
try {
  COS = require("cos-nodejs-sdk-v5");
} catch {
  COS = null;
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const IMG_DIR = path.join(DATA_DIR, "gen-images");
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

async function uploadImageFile(id, filePath) {
  if (!isConfigured() || !id || !filePath || !fs.existsSync(filePath)) return null;
  const c = config();
  const cos = client();
  const Key = objectKey(id);
  // 桶建议私有读写：对外统一走 /api/image/file/:id，服务端用密钥从 COS 拉回
  await promisify(cos.putObject.bind(cos), {
    Bucket: c.bucket,
    Region: c.region,
    Key,
    Body: fs.createReadStream(filePath),
    ContentType: "image/jpeg",
  });
  return publicUrl(id);
}

async function ensureLocalFromCos(id) {
  if (!isConfigured() || !id) return null;
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  const local = path.join(IMG_DIR, `${safe}.jpg`);
  if (fs.existsSync(local)) return local;

  const c = config();
  const cos = client();
  const data = await promisify(cos.getObject.bind(cos), {
    Bucket: c.bucket,
    Region: c.region,
    Key: objectKey(id),
  });
  const body = data && data.Body;
  if (!body) return null;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  fs.writeFileSync(local, buf);
  return local;
}

module.exports = {
  isConfigured,
  config,
  uploadImageFile,
  ensureLocalFromCos,
  publicUrl,
  objectKey,
};
