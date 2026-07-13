const path = require('path');

const allowedImageTypes = new Map([
  ['image/jpeg', ['ffd8ff']],
  ['image/jpg', ['ffd8ff']],
  ['image/pjpeg', ['ffd8ff']],
  ['image/png', ['89504e47']],
  ['image/x-png', ['89504e47']],
  ['image/webp', ['52494646']],
  ['image/avif', ['6674797061766966']]
]);

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const normalizeString = (value, maxLength = 1000) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const slugifyFileName = (value, fallback = 'product-image') => {
  const ascii = normalizeString(value, 120)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || fallback;
};

const resolveImageAlt = (body = {}, file = {}) => {
  return normalizeString(body.altText || body.imageAlt || body.title || file.originalname || 'Product image', 180);
};

const toImageUrl = (id, variant = 'full') => variant === 'thumb' ? `/api/images/${id}/thumb` : `/api/images/${id}`;

const parseDbImageUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/api\/images\/([^/?#]+)(?:\/thumb)?/);
  return match ? match[1] : null;
};

const isDbImageUrl = (url) => Boolean(parseDbImageUrl(url));

const sharp = require('sharp');

const optimizeImage = async (file, type) => {
  const extension = path.extname(file.originalname).replace('.', '') || 'jpg';
  
  let detectedMime = file.mimetype;
  const hex = file.buffer.toString('hex', 0, 8);
  for (const [mime, prefixes] of allowedImageTypes.entries()) {
    if (prefixes.some(p => hex.startsWith(p))) {
      detectedMime = mime;
      break;
    }
  }

  let finalBuffer = file.buffer;
  let finalWidth = null;
  let finalHeight = null;

  if (type === 'side-banner') {
    try {
      console.log('Resizing uploaded side-banner image to 800x400 using sharp...');
      finalBuffer = await sharp(file.buffer)
        .resize(800, 400, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
      finalWidth = 800;
      finalHeight = 400;
    } catch (sharpError) {
      console.error('Failed to resize image with sharp:', sharpError);
    }
  } else if (type === 'slider') {
    try {
      console.log('Resizing uploaded slider image to 1200x600 using sharp...');
      finalBuffer = await sharp(file.buffer)
        .resize(1200, 600, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
      finalWidth = 1200;
      finalHeight = 600;
    } catch (sharpError) {
      console.error('Failed to resize slider image with sharp:', sharpError);
    }
  }

  return {
    data: finalBuffer,
    thumbnailData: null, // Let it fallback to full image for speed
    mimeType: detectedMime,
    width: finalWidth,
    height: finalHeight,
    size: finalBuffer.length,
    extension: extension.toLowerCase()
  };
};

const parsePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const toPositiveNumber = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${fieldName} must be a positive number`);
    error.status = 400;
    throw error;
  }
  return parsed;
};

const pick = (source, allowedKeys) => {
  const result = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
};

module.exports = {
  asyncHandler,
  normalizeString,
  slugifyFileName,
  resolveImageAlt,
  toImageUrl,
  parseDbImageUrl,
  isDbImageUrl,
  optimizeImage,
  parsePositiveInt,
  toPositiveNumber,
  pick,
  allowedImageTypes
};
