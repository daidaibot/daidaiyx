const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const IMG_DIR = path.join(DATA_DIR, "gen-images");
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

let sharp = null;
try {
  sharp = require("sharp");
} catch (_) {
  sharp = null;
}

function ensureImgDir() {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
}

function watermarkSvg(width, height) {
  const w = Math.max(1, width || 1024);
  const h = Math.max(1, height || 1024);
  const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.035));
  const pad = Math.max(10, Math.round(fontSize * 0.7));
  const text = "呆呆 AI 生成";
  const tw = Math.round(fontSize * text.length * 0.92);
  const th = Math.round(fontSize * 1.45);
  const x = Math.max(0, w - tw - pad);
  const y = Math.max(0, h - pad);
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x - 8}" y="${y - th - 2}" width="${tw + 16}" height="${th + 10}" rx="6" fill="rgba(0,0,0,0.40)"/>
      <text x="${x}" y="${y - 6}" font-size="${fontSize}" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="rgba(255,255,255,0.95)">${text}</text>
    </svg>`
  );
}

async function bufferFromUpstreamItem(item) {
  if (item && item.b64_json) {
    return Buffer.from(String(item.b64_json), "base64");
  }
  if (item && item.url) {
    const upstream = await fetch(item.url);
    if (!upstream.ok) {
      throw new Error(`拉取上游图片失败 HTTP ${upstream.status}`);
    }
    return Buffer.from(await upstream.arrayBuffer());
  }
  throw new Error("上游未返回图片数据");
}

/**
 * 压缩 + 右下角水印「呆呆 AI 生成」，写入磁盘
 */
async function saveGeneratedImage(item) {
  ensureImgDir();
  const raw = await bufferFromUpstreamItem(item);
  const id = `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const file = path.join(IMG_DIR, `${id}.jpg`);

  if (sharp) {
    const resized = await sharp(raw)
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer({ resolveWithObject: true });

    await sharp(resized.data)
      .composite([
        {
          input: watermarkSvg(resized.info.width, resized.info.height),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(file);
  } else {
    fs.writeFileSync(file, raw);
  }

  return { id, file, mime: "image/jpeg", bytes: fs.statSync(file).size };
}

function resolveImageFile(id) {
  const safe = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  const file = path.join(IMG_DIR, `${safe}.jpg`);
  if (!fs.existsSync(file)) return null;
  return file;
}

function cleanupOldImages() {
  try {
    ensureImgDir();
    const now = Date.now();
    for (const name of fs.readdirSync(IMG_DIR)) {
      const full = path.join(IMG_DIR, name);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > MAX_AGE_MS) fs.unlinkSync(full);
    }
  } catch (_) {
    /* ignore */
  }
}

function publicOrigin(req, settings) {
  const base = String(require("./ops").getPublicApiBase(settings) || "").replace(/\/$/, "");
  if (base) return base;
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

module.exports = {
  saveGeneratedImage,
  resolveImageFile,
  cleanupOldImages,
  publicOrigin,
  hasSharp: () => Boolean(sharp),
};
