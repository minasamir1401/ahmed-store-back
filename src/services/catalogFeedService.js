const { slugify, getProductUrlParam } = require('../utils/slug');

let cachedXml = null;
let cachedCsv = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function invalidateCatalogCache() {
  cachedXml = null;
  cachedCsv = null;
  lastCacheTime = 0;
}

function cleanText(text, maxLength = 5000) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    // Strip XML invalid control characters (XML 1.0 restricts 0x00-0x1F except tab, CR, LF)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\]\]>/g, ']]&gt;')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function escapeCdata(text) {
  if (!text) return '';
  return String(text).replace(/\]\]>/g, ']]&gt;');
}

function resolveImageUrl(imagePath, siteUrl) {
  if (!imagePath) return `${siteUrl}/logo-header.jpg`;
  
  if (/^https?:\/\//i.test(imagePath)) {
    // Encode spaces in external URLs
    return imagePath.trim().replace(/ /g, '%20');
  }

  const cleanPath = imagePath.trim().startsWith('/') ? imagePath.trim() : `/${imagePath.trim()}`;
  const encodedPath = cleanPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${siteUrl}${encodedPath}`;
}

async function getFeedProducts(prisma) {
  return await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { name: true, nameEn: true } },
      brand: { select: { name: true, nameEn: true } },
    },
  });
}

function parseGalleryImages(raw, productId, siteUrl) {
  if (!raw) return [];
  try {
    const list = Array.isArray(raw) ? raw : JSON.parse(raw);
    if (Array.isArray(list)) {
      return list.slice(0, 10).map((_, idx) => `${siteUrl}/api/catalog/image/${productId}/gallery/${idx}.jpg`);
    }
  } catch {}
  return [];
}

function buildProductFeedItem(product, siteUrl) {
  const param = getProductUrlParam(product);
  const link = `${siteUrl}/product/${param}`.replace(/ /g, '%20');
  
  // Dedicated high-resolution JPEG endpoint ensuring 100% Meta compliance regardless of source format (AVIF, WebP, external)
  const imageLink = `${siteUrl}/api/catalog/image/${product.id}.jpg`;
  const additionalImages = parseGalleryImages(product.images, product.id, siteUrl);

  const rawTitle = cleanText(product.title, 150);
  const title = rawTitle.includes('The VitaHub') ? rawTitle : `${rawTitle} | The VitaHub`;

  const rawDesc = cleanText(
    product.seoDesc || product.desc || `تسوق ${product.title} الأصلي 100% بأفضل سعر من The VitaHub مع توصيل سريع لجميع المحافظات.`,
    5000
  );

  const brandName = product.brand?.name ? `The VitaHub - ${product.brand.name}` : 'The VitaHub';
  const categoryName = product.category?.name || 'مكملات غذائية';

  const currentPrice = Number(product.price) || 0;
  const oldPrice = Number(product.oldPrice) || 0;

  const hasDiscount = oldPrice > currentPrice && currentPrice > 0;
  const basePriceFormatted = hasDiscount ? `${oldPrice.toFixed(2)} EGP` : `${currentPrice.toFixed(2)} EGP`;
  const salePriceFormatted = hasDiscount ? `${currentPrice.toFixed(2)} EGP` : null;

  return {
    id: product.id,
    title,
    description: rawDesc,
    link,
    imageLink,
    additionalImages,
    brand: brandName,
    condition: 'new',
    availability: 'in stock',
    price: basePriceFormatted,
    salePrice: salePriceFormatted,
    categoryName,
    productType: `The VitaHub > ${categoryName}`,
    googleProductCategory: 'Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements',
  };
}

async function generateFacebookXmlFeed(prisma, siteUrl = 'https://the-vitahub.com') {
  const now = Date.now();
  if (cachedXml && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedXml;
  }

  const products = await getFeedProducts(prisma);
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '');

  const itemsXml = products
    .map((product) => {
      const item = buildProductFeedItem(product, cleanSiteUrl);
      const additionalTags = (item.additionalImages || [])
        .map((img) => `      <g:additional_image_link><![CDATA[${escapeCdata(img)}]]></g:additional_image_link>`)
        .join('\n');

      return `    <item>
      <g:id><![CDATA[${item.id}]]></g:id>
      <g:title><![CDATA[${escapeCdata(item.title)}]]></g:title>
      <g:description><![CDATA[${escapeCdata(item.description)}]]></g:description>
      <g:link><![CDATA[${escapeCdata(item.link)}]]></g:link>
      <g:image_link><![CDATA[${escapeCdata(item.imageLink)}]]></g:image_link>
${additionalTags ? additionalTags + '\n' : ''}      <g:brand><![CDATA[${escapeCdata(item.brand)}]]></g:brand>
      <g:condition>${item.condition}</g:condition>
      <g:availability>${item.availability}</g:availability>
      <g:price>${item.price}</g:price>
${item.salePrice ? `      <g:sale_price>${item.salePrice}</g:sale_price>\n` : ''}      <g:google_product_category><![CDATA[${escapeCdata(item.googleProductCategory)}]]></g:google_product_category>
      <g:fb_product_category><![CDATA[${escapeCdata(item.googleProductCategory)}]]></g:fb_product_category>
      <g:product_type><![CDATA[${escapeCdata(item.productType)}]]></g:product_type>
      <g:item_group_id><![CDATA[${item.id}]]></g:item_group_id>
      <g:custom_label_0><![CDATA[The VitaHub]]></g:custom_label_0>
      <g:custom_label_1><![CDATA[${escapeCdata(item.categoryName)}]]></g:custom_label_1>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>The VitaHub - Official Store Catalog Feed</title>
    <link>${cleanSiteUrl}</link>
    <description>Official Products Catalog Feed for The VitaHub Store</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;

  cachedXml = xml;
  lastCacheTime = now;
  return xml;
}

function escapeCsvField(field) {
  if (field === null || field === undefined) return '""';
  const str = String(field).replace(/"/g, '""');
  return `"${str}"`;
}

async function generateFacebookCsvFeed(prisma, siteUrl = 'https://the-vitahub.com') {
  const now = Date.now();
  if (cachedCsv && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedCsv;
  }

  const products = await getFeedProducts(prisma);
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '');

  const headers = [
    'id',
    'title',
    'description',
    'availability',
    'condition',
    'price',
    'link',
    'image_link',
    'additional_image_link',
    'brand',
    'google_product_category',
    'fb_product_category',
    'sale_price',
    'product_type',
    'custom_label_0',
  ];

  const rows = products.map((product) => {
    const item = buildProductFeedItem(product, cleanSiteUrl);
    return [
      escapeCsvField(item.id),
      escapeCsvField(item.title),
      escapeCsvField(item.description),
      escapeCsvField(item.availability),
      escapeCsvField(item.condition),
      escapeCsvField(item.price),
      escapeCsvField(item.link),
      escapeCsvField(item.imageLink),
      escapeCsvField(item.additionalImages?.join(',') || ''),
      escapeCsvField(item.brand),
      escapeCsvField(item.googleProductCategory),
      escapeCsvField(item.googleProductCategory),
      escapeCsvField(item.salePrice || ''),
      escapeCsvField(item.productType),
      escapeCsvField('The VitaHub'),
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  cachedCsv = csv;
  lastCacheTime = now;
  return csv;
}

async function getCatalogFeedStats(prisma) {
  const count = await prisma.product.count();
  return {
    storeName: 'The VitaHub',
    totalProducts: count,
    feedFormats: ['xml', 'csv'],
    cacheActive: Boolean(cachedXml),
    lastCacheAgeSeconds: lastCacheTime ? Math.round((Date.now() - lastCacheTime) / 1000) : 0,
  };
}

module.exports = {
  generateFacebookXmlFeed,
  generateFacebookCsvFeed,
  getCatalogFeedStats,
  invalidateCatalogCache,
};
