const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const CACHE_DIR = path.join(UPLOADS_DIR, 'catalog-cache');
const FALLBACK_IMAGE_PATH = path.join(UPLOADS_DIR, 'logo-header.jpg');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function sanitizeProductId(rawId) {
  if (!rawId) return '';
  return String(rawId).replace(/\.(jpg|jpeg|png|webp|avif)$/i, '').trim();
}

async function getSourceBuffer(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') return null;

  const trimmed = imagePath.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const response = await fetch(trimmed, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  let cleanName = trimmed.replace(/^\/?uploads\/?/i, '').replace(/^\/+/, '');
  try {
    cleanName = decodeURIComponent(cleanName);
  } catch {}

  const localPath = path.join(UPLOADS_DIR, cleanName);
  if (fs.existsSync(localPath)) {
    return await fs.promises.readFile(localPath);
  }

  // Fallback: check if exact encoded name exists
  const encodedPath = path.join(UPLOADS_DIR, trimmed.replace(/^\/?uploads\/?/i, '').replace(/^\/+/, ''));
  if (fs.existsSync(encodedPath)) {
    return await fs.promises.readFile(encodedPath);
  }

  return null;
}

async function serveFallback(res) {
  try {
    if (fs.existsSync(FALLBACK_IMAGE_PATH)) {
      const fallbackBuffer = await sharp(FALLBACK_IMAGE_PATH)
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.status(200).send(fallbackBuffer);
    }
  } catch {}

  // Generate blank white fallback if logo file unavailable
  const fallbackBlank = await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 245, g: 247, b: 250 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(fallbackBlank);
}

async function serveCatalogProductImage(req, res, prisma) {
  try {
    ensureCacheDir();

    const rawId = req.params.productId;
    const galleryIndex = req.params.galleryIndex ? parseInt(req.params.galleryIndex, 10) : null;
    const productId = sanitizeProductId(rawId);

    if (!productId) {
      return await serveFallback(res);
    }

    const cacheKey = galleryIndex !== null ? `${productId}_g${galleryIndex}.jpg` : `${productId}.jpg`;
    const cacheFilePath = path.join(CACHE_DIR, cacheKey);

    if (fs.existsSync(cacheFilePath)) {
      const stat = await fs.promises.stat(cacheFilePath);
      if (stat.size > 500) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        res.setHeader('X-Catalog-Image-Cache', 'HIT');
        return res.sendFile(cacheFilePath);
      }
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, image: true, images: true },
    });

    if (!product) {
      return await serveFallback(res);
    }

    let targetImagePath = product.image;
    if (galleryIndex !== null) {
      const galleryList = parseImages(product.images);
      if (galleryList[galleryIndex]) {
        targetImagePath = galleryList[galleryIndex];
      }
    }

    let sourceBuffer = await getSourceBuffer(targetImagePath);

    // If main image failed, try first gallery image
    if (!sourceBuffer && targetImagePath !== product.image) {
      sourceBuffer = await getSourceBuffer(product.image);
    }
    if (!sourceBuffer && product.images) {
      const galleryList = parseImages(product.images);
      for (const item of galleryList) {
        sourceBuffer = await getSourceBuffer(item);
        if (sourceBuffer) break;
      }
    }

    if (!sourceBuffer) {
      return await serveFallback(res);
    }

    const processedJpeg = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    await fs.promises.writeFile(cacheFilePath, processedJpeg).catch(() => {});

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    res.setHeader('X-Catalog-Image-Cache', 'MISS');
    return res.status(200).send(processedJpeg);
  } catch (error) {
    console.error('Error serving catalog image:', error);
    return await serveFallback(res);
  }
}

module.exports = {
  serveCatalogProductImage,
};
