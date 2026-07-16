const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { outboundFetch } = require("./outbound");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const IMG_DIR = path.join(DATA_DIR, "gen-images");
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const WATERMARK_TEXT = "呆呆 AI 生成";

let sharp = null;
try {
  sharp = require("sharp");
} catch (_) {
  sharp = null;
}

function ensureImgDir() {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
}

/** 烙进 JPEG 右下角的小水印（下载/预览同源）；不走 UI 浮层 */
function watermarkSvg(width, height) {
  const w = Math.max(1, width || 1024);
  const h = Math.max(1, height || 1024);
  // 约 2.2% 边长，字体偏小不抢画面
  const fontSize = Math.max(13, Math.min(22, Math.round(Math.min(w, h) * 0.022)));
  const pad = Math.max(10, Math.round(fontSize * 0.7));
  const boxH = Math.round(fontSize * 1.55);
  const boxW = Math.round(fontSize * 6.2 + 16);
  const x = w - pad;
  const y = h - pad;
  const bx = Math.max(0, x - boxW);
  const by = Math.max(0, y - boxH);
  const font =
    "Noto Sans CJK SC, WenQuanYi Zen Hei, PingFang SC, Microsoft YaHei, sans-serif";
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="5" fill="rgba(0,0,0,0.38)"/>
      <text x="${x}" y="${y - Math.round(fontSize * 0.32)}" text-anchor="end"
        font-size="${fontSize}" font-family="${font}" font-weight="500"
        fill="rgba(255,255,255,0.92)">${WATERMARK_TEXT}</text>
    </svg>`
  );
}

async function bufferFromUpstreamItem(item) {
  if (item && item.b64_json) {
    return Buffer.from(String(item.b64_json), "base64");
  }
  if (item && item.url) {
    const upstream = await outboundFetch(item.url);
    if (!upstream.ok) {
      throw new Error(`拉取上游图片失败 HTTP ${upstream.status}`);
    }
    return Buffer.from(await upstream.arrayBuffer());
  }
  throw new Error("上游未返回图片数据");
}

/**
 * 压缩 + 右下角水印「呆呆 AI 生成」，写入磁盘（下载/预览同源文件，水印一定在文件里）
 */
async function saveGeneratedImage(item) {
  ensureImgDir();
  const raw = await bufferFromUpstreamItem(item);
  const id = `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const file = path.join(IMG_DIR, `${id}.jpg`);

  if (!sharp) {
    console.warn("[imageOut] sharp 不可用，图片将无压缩/水印写入");
    fs.writeFileSync(file, raw);
    return { id, file, mime: "image/jpeg", bytes: fs.statSync(file).size, watermarked: false };
  }

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
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(file);

  return {
    id,
    file,
    mime: "image/jpeg",
    bytes: fs.statSync(file).size,
    watermarked: true,
  };
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
  const base = String(require("./ops").getPublicApiBase(settings) || "")
    .trim()
    .replace(/\/$/, "");
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
