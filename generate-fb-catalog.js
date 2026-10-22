require('dotenv').config();

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', '@localhost:5432');
}

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

const SITE_URL = 'https://the-vitahub.com';
const CURRENCY = 'EGP';

/**
 * Normalize an image path to a full absolute URL.
 * Handles: full URLs, /uploads/... relative paths, and base64 (ignored).
 */
function normalizeImageUrl(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/')) return `${SITE_URL}${s}`;
  if (s.startsWith('data:')) return null; // base64 — not usable by Facebook
  return null;
}

/**
 * Extract main image URL from the `image` field.
 */
function parseMainImage(imageField) {
  if (!imageField) return null;
  const s = imageField.trim();
  // Could be a raw URL or path
  if (!s.startsWith('[') && !s.startsWith('{')) {
    return normalizeImageUrl(s);
  }
  // Could be a JSON array
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr) && arr.length > 0) {
      const first = typeof arr[0] === 'string' ? arr[0] : (arr[0] && (arr[0].url || arr[0].src));
      return normalizeImageUrl(first || null);
    }
  } catch (_) {}
  return null;
}

/**
 * Extract gallery URLs from the `images` field (JSON array of strings or objects).
 */
function parseGalleryImages(imagesField) {
  if (!imagesField) return [];
  const s = imagesField.trim();
  const results = [];

  const push = (val) => {
    const url = normalizeImageUrl(typeof val === 'string' ? val : (val && (val.url || val.src || val.image)));
    if (url) results.push(url);
  };

  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) arr.forEach(push);
    } catch (_) {}
  } else if (s.startsWith('http') || s.startsWith('/')) {
    push(s);
  }

  return results;
}

/**
 * Compute the effective selling price after discount.
 */
function computeFinalPrice(price, discountType, discountValue) {
  if (!price) return null;
  const base = parseFloat(price);
  if (isNaN(base) || base <= 0) return null;
  if (!discountType || !discountValue) return base;
  const dv = parseFloat(discountValue);
  if (isNaN(dv) || dv <= 0) return base;
  if (discountType === 'PERCENTAGE') return Math.max(0, +(base - base * dv / 100).toFixed(2));
  if (discountType === 'FIXED') return Math.max(0, +(base - dv).toFixed(2));
  return base;
}

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      title: true,
      titleEn: true,
      desc: true,
      descEn: true,
      image: true,
      images: true,
      imageAlt: true,
      price: true,
      oldPrice: true,
      discountType: true,
      discountValue: true,
      tag: true,
      seoDesc: true,
      seoDescEn: true,
      keyInfo: true,
      expiryDate: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } }
    },
    orderBy: { id: 'asc' }
  });

  console.log(`Loaded ${products.length} products from DB\n`);

  const stats = { included: 0, noImage: 0, noPrice: 0 };
  const skippedLog = { noImage: [], noPrice: [] };
  const items = [];

  for (const p of products) {
    const mainImage = parseMainImage(p.image);
    if (!mainImage) {
      stats.noImage++;
      skippedLog.noImage.push({ id: p.id, title: (p.title || '').substring(0, 60), raw: (p.image || '').substring(0, 100) });
      continue;
    }

    const finalPrice = computeFinalPrice(p.price, p.discountType, p.discountValue);
    if (!finalPrice) {
      stats.noPrice++;
      skippedLog.noPrice.push({ id: p.id, title: (p.title || '').substring(0, 60) });
      continue;
    }

    const gallery = parseGalleryImages(p.images).filter(u => u !== mainImage).slice(0, 9);

    const title = escapeXml((p.titleEn || p.title || '').substring(0, 150));
    const description = escapeXml(
      (p.descEn || p.seoDescEn || p.desc || p.seoDesc || p.titleEn || p.title || '').substring(0, 9999)
    );
    const productUrl = `${SITE_URL}/product/${p.id}`;
    const brand = escapeXml(p.brand ? p.brand.name : 'The VitaHub');
    const category = escapeXml(p.category ? p.category.name : 'Health & Nutrition');

    const sellPrice = finalPrice.toFixed(2);
    const listPrice = p.oldPrice ? parseFloat(p.oldPrice) : null;

    let xml = '  <item>\n';
    xml += `    <g:id>${escapeXml(p.id)}</g:id>\n`;
    xml += `    <g:title>${title}</g:title>\n`;
    xml += `    <g:description>${description || title}</g:description>\n`;
    xml += `    <g:link>${escapeXml(productUrl)}</g:link>\n`;
    xml += `    <g:image_link>${escapeXml(mainImage)}</g:image_link>\n`;

    for (const imgUrl of gallery) {
      xml += `    <g:additional_image_link>${escapeXml(imgUrl)}</g:additional_image_link>\n`;
    }

    xml += `    <g:availability>in stock</g:availability>\n`;
    xml += `    <g:condition>new</g:condition>\n`;
    xml += `    <g:price>${sellPrice} ${CURRENCY}</g:price>\n`;

    if (listPrice && listPrice > finalPrice) {
      xml += `    <g:sale_price>${sellPrice} ${CURRENCY}</g:sale_price>\n`;
    }

    xml += `    <g:brand>${brand}</g:brand>\n`;
    xml += `    <g:google_product_category>5765</g:google_product_category>\n`;
    xml += `    <g:product_type>${category}</g:product_type>\n`;

    if (p.tag) {
      p.tag.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3).forEach((t, i) => {
        xml += `    <g:custom_label_${i}>${escapeXml(t.substring(0, 100))}</g:custom_label_${i}>\n`;
      });
    }

    xml += '  </item>\n';
    items.push(xml);
    stats.included++;
  }

  const feedXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>The VitaHub - Product Catalog</title>`,
    `    <link>${SITE_URL}</link>`,
    `    <description>The VitaHub product catalog for Facebook Commerce Manager</description>`,
    ...items,
    '  </channel>',
    '</rss>'
  ].join('\n');

  const outPath = '../vitahub-facebook-catalog.xml';
  fs.writeFileSync(outPath, feedXml, 'utf-8');

  console.log('============================================================');
  console.log('  Facebook Catalog Feed — Generation Complete');
  console.log('============================================================');
  console.log(`  Total products in DB   : ${products.length}`);
  console.log(`  Included in feed       : ${stats.included}`);
  console.log(`  Skipped (no image URL) : ${stats.noImage}`);
  console.log(`  Skipped (no price)     : ${stats.noPrice}`);
  console.log(`  Output file            : ${outPath}`);
  console.log('============================================================\n');

  if (skippedLog.noImage.length > 0) {
    console.log('Products with MISSING/LOCAL image (not included in feed):');
    skippedLog.noImage.forEach(p => {
      console.log(`  [${p.id}] ${p.title}`);
      console.log(`    raw image: ${p.raw}`);
    });
  }

  if (skippedLog.noPrice.length > 0) {
    console.log('\nProducts with MISSING price (not included in feed):');
    skippedLog.noPrice.forEach(p => console.log(`  [${p.id}] ${p.title}`));
  }

  // Verify sample of output
  const lineCount = feedXml.split('\n').length;
  const itemCount = (feedXml.match(/<item>/g) || []).length;
  console.log(`\nXML file: ${lineCount} lines | ${itemCount} <item> blocks`);
  console.log('Feed size:', (Buffer.byteLength(feedXml, 'utf-8') / 1024).toFixed(1), 'KB');
}

main()
  .catch(e => { console.error('FATAL:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
