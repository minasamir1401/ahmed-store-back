const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateFacebookXmlFeed, generateFacebookCsvFeed } = require('../src/services/catalogFeedService');

test('catalog XML feed outputs clean entity-escaped URLs and IDs without CDATA wrappers', async () => {
  const mockPrisma = {
    product: {
      findMany: async () => [
        {
          id: 'prod_123',
          title: 'Vitamin D3 & K2 <Extra>',
          desc: 'High potency formula & immune support',
          seoDesc: null,
          price: 450,
          oldPrice: 500,
          image: '/uploads/vit-d3.jpg',
          images: '["/uploads/vit-d3-back.jpg"]',
          createdAt: new Date(),
          category: { name: 'فيتامينات', nameEn: 'Vitamins' },
          brand: { name: 'VitaHub Care', nameEn: 'VitaHub Care' },
        },
      ],
    },
  };

  const xml = await generateFacebookXmlFeed(mockPrisma, 'https://the-vitahub.com');

  // Verify IDs and URLs are direct XML elements, not wrapped in CDATA
  assert.match(xml, /<g:id>prod_123<\/g:id>/);
  assert.match(xml, /<g:link>https:\/\/the-vitahub\.com\/product\/.*prod_123<\/g:link>/);
  assert.match(xml, /<g:image_link>https:\/\/the-vitahub\.com\/api\/catalog\/image\/prod_123\.jpg<\/g:image_link>/);
  assert.match(xml, /<g:additional_image_link>https:\/\/the-vitahub\.com\/api\/catalog\/image\/prod_123\/gallery\/0\.jpg<\/g:additional_image_link>/);
  assert.match(xml, /<g:item_group_id>prod_123<\/g:item_group_id>/);

  // Negative assertion: g:id and image links must NEVER have CDATA
  assert.doesNotMatch(xml, /<g:id><!\[CDATA\[/);
  assert.doesNotMatch(xml, /<g:image_link><!\[CDATA\[/);
  assert.doesNotMatch(xml, /<g:link><!\[CDATA\[/);

  // Verify text fields use CDATA
  assert.match(xml, /<g:title><!\[CDATA\[Vitamin D3 & K2 \| The VitaHub\]\]><\/g:title>/);
});

test('catalog CSV feed generates properly formatted columns for Meta', async () => {
  const mockPrisma = {
    product: {
      findMany: async () => [
        {
          id: 'prod_csv_1',
          title: 'Omega 3 Fish Oil',
          desc: '1000mg EPA/DHA',
          seoDesc: null,
          price: 600,
          oldPrice: 0,
          image: '/uploads/omega.jpg',
          images: null,
          createdAt: new Date(),
          category: { name: 'أوميجا', nameEn: 'Omega' },
          brand: null,
        },
      ],
    },
  };

  const csv = await generateFacebookCsvFeed(mockPrisma, 'https://the-vitahub.com');
  const lines = csv.split('\n');

  assert.ok(lines.length >= 2);
  assert.match(lines[0], /^id,title,description,availability/);
  assert.match(lines[1], /"prod_csv_1"/);
  assert.match(lines[1], /https:\/\/the-vitahub\.com\/api\/catalog\/image\/prod_csv_1\.jpg/);
});

test('serveCatalogProductImage attaches CORS and CORP headers on fallback and valid responses', async () => {
  const { serveCatalogProductImage } = require('../src/services/catalogImageService');
  const headers = {};
  const mockRes = {
    setHeader: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
    status: (code) => ({
      send: (buf) => ({ code, buf }),
    }),
    sendFile: (p) => ({ file: p }),
  };

  const mockReq = {
    params: { productId: 'non_existent_product' },
  };

  const mockPrisma = {
    product: {
      findUnique: async () => null,
    },
  };

  await serveCatalogProductImage(mockReq, mockRes, mockPrisma);

  assert.equal(headers['access-control-allow-origin'], '*');
  assert.equal(headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(headers['content-type'], 'image/jpeg');
});
