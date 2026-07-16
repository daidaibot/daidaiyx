const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { outboundFetch } = require("./outbound");
const cosStore = require("./cosStore");

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

/**
 * 透明底水印：仅白字 + 细描边，无灰底条（常见摄影/App 出图做法）
 * 参考：Sharp 用 SVG composite + stroke 保证亮/暗背景都可读
 */
function watermarkSvg(fontSize) {
  const pad = Math.max(8, Math.round(fontSize * 0.55));
  const w = Math.round(fontSize * WATERMARK_TEXT.length * 0.58 + pad * 2);
  const h = Math.round(fontSize * 1.35 + pad);
  const font =
    "Noto Sans CJK SC, WenQuanYi Zen Hei, PingFang SC, Microsoft YaHei, sans-serif";
  const ty = h - pad;
  const tx = w - pad;
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <text x="${tx}" y="${ty}" text-anchor="end"
        font-size="${fontSize}" font-family="${font}" font-weight="500"
        fill="rgba(255,255,255,0.9)"
        stroke="rgba(0,0,0,0.42)"
        stroke-width="1.6"
        paint-order="stroke fill">${WATERMARK_TEXT}</text>
    </svg>`
  );
}

function watermarkFontSize(imgW, imgH) {
  // 约 1.5 倍于旧版（旧：0.02 / 12–20 → 新：0.03 / 18–30）
  return Math.max(18, Math.min(30, Math.round(Math.min(imgW, imgH) * 0.03)));
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

  const fontSize = watermarkFontSize(resized.info.width, resized.info.height);

  await sharp(resized.data)
    .composite([
      {
        input: watermarkSvg(fontSize),
        gravity: "southeast",
        blend: "over",
      },
    ])
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(file);

  const result = {
    id,
    file,
    mime: "image/jpeg",
    bytes: fs.statSync(file).size,
    watermarked: true,
  };

  if (cosStore.isConfigured()) {
    try {
      const cosUrl = await cosStore.uploadImageFile(id, file);
      if (cosUrl) result.cosUrl = cosUrl;
    } catch (e) {
      console.error("[imageOut] COS upload failed:", e.message);
    }
  }

  return result;
}

function resolveImageFile(id) {
  const safe = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  const file = path.join(IMG_DIR, `${safe}.jpg`);
  if (fs.existsSync(file)) return file;
  return null;
}

async function resolveImageFileAsync(id) {
  const local = resolveImageFile(id);
  if (local) return local;
  if (!cosStore.isConfigured()) return null;
  try {
    return await cosStore.ensureLocalFromCos(id);
  } catch (e) {
    console.error("[imageOut] COS fetch failed:", e.message);
    return null;
  }
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
  resolveImageFileAsync,
  cleanupOldImages,
  publicOrigin,
  hasSharp: () => Boolean(sharp),
};
