const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseProductImages } = require('../utils/productImages');
const { UPLOADS_DIR, framedPath, localUploadName } = require('../utils/productFrameFiles');

const FRAME_TEMPLATE = path.resolve(__dirname, '../../assets/frame.png');
const LEGACY_PLACEHOLDER = 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae';
const CACHE_MS = 60_000;
const BANNER_IMAGE_ERROR = 'دي صورة قسم أو بانر. ارفع صورة العبوة الأصلية.';
// Keep verified legacy banner renders blocked even after the category changes its cover.
const LEGACY_BANNER_RENDER_HASHES = [
  '6d00b350aef98320f51daea9776739580e76cf07feb35d06b7eef7a3773f75fc',
  'c154fe7e70cbcfb7fd91a01a3bfb2e6bd5f0a09f7921efc8fa7b638720131170',
  '50cdeba7cfc2dc6c5167df36f636028d095a8f0fcfc590dc9af2412d725c69f3',
  'f3a680b9242d3810976465dc6dab382d468f575eb558bc048e0ba9ed6f02a1f5',
  '694b859e03143e673cba765dd9ecdccdbb59c9b9d30b8875f8e8dc7373bdfc15',
];
let defaultFrameDigest;

function artworkKey(source) {
  if (typeof source !== 'string' || !source.trim()) return '';
  const name = localUploadName(source);
  if (name) return `local:${name}`;
  try {
    const url = new URL(source.trim(), 'https://the-vitahub.com');
    const pathname = url.origin + url.pathname;
    if (pathname === LEGACY_PLACEHOLDER || pathname === 'https://placehold.co/400x400') return pathname;
    if (['the-vitahub.com', 'www.the-vitahub.com', 'api.the-vitahub.com'].includes(url.hostname) && framedPath(url.pathname)) {
      return url.pathname;
    }
    if (/^https?:\/\//i.test(source.trim())) {
      url.hash = '';
      return url.href;
    }
  } catch {}
  return source.trim();
}

function localizedImages(source) {
  if (typeof source !== 'string' || !source.trim()) return [];
  if (!source.trim().startsWith('{')) return [source];
  try {
    const { ar, en } = JSON.parse(source);
    return [ar, en].filter(value => typeof value === 'string' && value.trim());
  } catch {
    return [];
  }
}

function heroImages(hero) {
  if (!hero) return [];
  const images = [hero.image, hero.side1Image, hero.side2Image];
  for (const slot of [1, 2, 3, 4]) {
    if (hero[`prod${slot}Type`] === 'category') images.push(hero[`prod${slot}Image`]);
  }
  try {
    const slides = JSON.parse(hero.slides || '[]');
    if (Array.isArray(slides)) images.push(...slides.map(slide => slide?.image));
  } catch {}
  return images.flatMap(localizedImages);
}

function excludedArtworkKeys(sources = []) {
  return new Set([LEGACY_PLACEHOLDER, 'https://placehold.co/400x400', '/logo-header.jpg', ...sources.flatMap(localizedImages)].map(artworkKey));
}

async function loadProductArtwork(prisma, { uploadsDir = UPLOADS_DIR, frameDigest } = {}) {
  const [categories, hero] = await Promise.all([
    prisma.category.findMany({ select: { image: true } }),
    prisma.hero.findUnique({ where: { id: 'hero-section' } }),
  ]);
  const sources = [...categories.flatMap(category => localizedImages(category.image)), ...heroImages(hero)];
  const excluded = excludedArtworkKeys(sources);
  for (const hash of LEGACY_BANNER_RENDER_HASHES) {
    excluded.add(`/uploads/product-frames/v2-${hash}.jpg`);
    excluded.add(`/uploads/product-frames/v3-${hash}.jpg`);
  }
  const digest = frameDigest || (defaultFrameDigest ||= createHash('sha256').update(await fs.readFile(FRAME_TEMPLATE)).digest());
  const inputHashes = new Set();
  for (const name of new Set(sources.map(localUploadName).filter(Boolean))) {
    try {
      const file = path.join(uploadsDir, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) continue;
      const bytes = await fs.readFile(file);
      const renderedHash = createHash('sha256').update(digest).update(bytes).digest('hex');
      inputHashes.add(createHash('sha256').update(bytes).digest('hex'));
      excluded.add(`/uploads/product-frames/v2-${renderedHash}.jpg`);
      excluded.add(`/uploads/product-frames/v3-${renderedHash}.jpg`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    excludes: source => excluded.has(artworkKey(source)),
    excludesBytes: input => inputHashes.has(createHash('sha256').update(input).digest('hex')),
  };
}

function createProductArtworkGuard(prisma) {
  let cached;
  let expires = 0;
  return () => {
    if (Date.now() >= expires) {
      expires = Date.now() + CACHE_MS;
      cached = loadProductArtwork(prisma).catch(error => {
        expires = 0;
        throw error;
      });
    }
    return cached;
  };
}

function hideProductArtwork(product, excludes) {
  const hideMain = excludes(product.image);
  const gallery = parseProductImages(product.images);
  const hideGallery = gallery.some(excludes);
  if (!hideMain && !hideGallery) return product;
  // Keep gallery indexes stable because catalog image URLs address the saved slot.
  return {
    ...product,
    ...(hideMain ? { image: '', imageWidth: null, imageHeight: null } : {}),
    ...(hideGallery ? { images: JSON.stringify(gallery.map(source => excludes(source) ? '/logo-header.jpg' : source)) } : {}),
  };
}

module.exports = { BANNER_IMAGE_ERROR, artworkKey, loadProductArtwork, createProductArtworkGuard, hideProductArtwork };
