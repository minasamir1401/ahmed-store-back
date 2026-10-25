const sharp = require('sharp');

// Bump both the feed URL and disk cache when the image processing contract changes.
const CATALOG_IMAGE_FORMAT = 'square-v1';
const CATALOG_IMAGE_SIZE = 1024;

async function normalizeCatalogImage(source) {
  return sharp(source)
    .rotate()
    .toColourspace('srgb')
    .resize(CATALOG_IMAGE_SIZE, CATALOG_IMAGE_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

module.exports = { CATALOG_IMAGE_FORMAT, CATALOG_IMAGE_SIZE, normalizeCatalogImage };
