const crypto = require("crypto");
const { outboundFetch } = require("./outbound");
const cosStore = require("./cosStore");
const blobStore = require("./blobStore");
const kvStore = require("./kvStore");

const WATERMARK_TEXT = "呆呆 AI 生成";

let sharp = null;
try {
  sharp = require("sharp");
} catch (_) {
  sharp = null;
}

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

async function processImageBuffer(raw) {
  if (!sharp) {
    console.warn("[imageOut] sharp 不可用，图片将无压缩/水印");
    return { buffer: raw, watermarked: false };
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
  const buffer = await sharp(resized.data)
    .composite([
      {
        input: watermarkSvg(fontSize),
        gravity: "southeast",
        blend: "over",
      },
    ])
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buffer, watermarked: true };
}

/**
 * 压缩 + 水印后写入 MySQL blobs（可选同步 COS）
 */
async function saveGeneratedImage(item, meta = {}) {
  const raw = await bufferFromUpstreamItem(item);
  const id = `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const processed = await processImageBuffer(raw);
  const buffer = processed.buffer;

  await blobStore.saveBlob({
    id,
    kind: "image",
    mime: "image/jpeg",
    data: buffer,
    ttlMs: blobStore.MAX_AGE_MS,
  });

  let cosUrl = null;
  if (cosStore.isConfigured()) {
    try {
      cosUrl = await cosStore.uploadImageBuffer(id, buffer);
    } catch (e) {
      console.error("[imageOut] COS upload failed:", e.message);
    }
  }

  kvStore
    .recordImageMeta({
      id,
      openid: meta.openid || "",
      jobId: meta.jobId || "",
      kind: meta.kind || "generate",
      prompt: meta.prompt || "",
      size: meta.size || "",
      filePath: "",
      bytes: buffer.length,
      watermarked: processed.watermarked,
      publicUrl: cosUrl || "",
      createdAt: Date.now(),
      expiresAt: Date.now() + blobStore.MAX_AGE_MS,
    })
    .catch(() => {});

  return {
    id,
    mime: "image/jpeg",
    bytes: buffer.length,
    watermarked: processed.watermarked,
    cosUrl,
  };
}

async function resolveImageBuffer(id) {
  const safe = blobStore.safeId(id);
  if (!safe) return null;
  const hit = await blobStore.getBlob(safe);
  if (hit && hit.data && hit.data.length) {
    return { buffer: hit.data, mime: hit.mime || "image/jpeg" };
  }
  if (!cosStore.isConfigured()) return null;
  try {
    const buffer = await cosStore.getImageBuffer(safe);
    if (buffer && buffer.length) {
      return { buffer, mime: "image/jpeg" };
    }
  } catch (e) {
    console.error("[imageOut] COS fetch failed:", e.message);
  }
  return null;
}

async function cleanupOldImages() {
  try {
    return await blobStore.cleanupExpired("image");
  } catch (e) {
    console.error("[imageOut] cleanup failed:", e.message);
    return 0;
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
  resolveImageBuffer,
  cleanupOldImages,
  publicOrigin,
  hasSharp: () => Boolean(sharp),
};
