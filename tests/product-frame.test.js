const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { BANNER_IMAGE_ERROR, hideProductArtwork, loadProductArtwork } = require('../src/services/productArtworkService');
const { FRAME_JOB_KEY, FrameSourceError, createProductFrameService, frameUploadedProductImage } = require('../src/services/productFrameService');
const { readRemoteProductImage } = require('../src/services/productFrameSource');
const { framedPath, readFrameAlias, retiredUploadHandler } = require('../src/utils/productFrameFiles');

const database = process.env.PRODUCT_FRAME_TEST_DATABASE_URL;

test('remote image redirects cannot reach an unapproved host', async () => {
  const requests = [];
  await assert.rejects(readRemoteProductImage('https://cdn.shopify.com/photo.png', async url => {
    requests.push(url.href);
    return Response.redirect('http://127.0.0.1/private', 302);
  }), FrameSourceError);
  assert.deepEqual(requests, ['https://cdn.shopify.com/photo.png']);
});

test('a product upload serves the merged JPEG and a general upload keeps its own format', async t => {
  const root = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(root, 'vitahub-frame-upload-'));
  const uploads = path.join(directory, 'uploads');
  await fs.mkdir(uploads);
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), root);
    assert.match(path.basename(directory), /^vitahub-frame-upload-[a-zA-Z0-9]+$/);
    await fs.rm(directory, { recursive: true, force: true });
  });

  const app = express();
  app.use('/uploads', express.static(uploads));
  const banner = await sharp({ create: { width: 420, height: 270, channels: 3, background: '#10fc10' } }).png().toBuffer();
  await fs.writeFile(path.join(uploads, 'category.png'), banner);
  const artwork = await loadProductArtwork({
    category: { findMany: async () => [{ image: '/uploads/category.png' }] },
    hero: { findUnique: async () => null },
  }, { uploadsDir: uploads });
  const index = await fs.readFile(path.join(__dirname, '../index.js'), 'utf8');
  const route = index.slice(index.indexOf("app.post('/api/upload',"), index.indexOf("app.post('/api/upload-multiple',"));
  vm.runInNewContext(route, {
    app, upload: multer({ storage: multer.memoryStorage() }),
    adminAuthenticate: (_req, _res, next) => next(),
    isAllowedImageBuffer: file => file.mimetype === 'image/png',
    resolveImageAlt: body => body.altText,
    optimizeImage: async file => ({ data: file.buffer, extension: 'png' }),
    slugifyFileName: () => 'general-image',
    crypto: { randomBytes }, fs: require('node:fs'), path, __dirname: directory,
    BANNER_IMAGE_ERROR, getProductArtwork: async () => artwork,
    FrameSourceError, frameUploadedProductImage: input => frameUploadedProductImage(input, uploads),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stripes = Buffer.alloc(16 * 40 * 3);
  for (let row = 0; row < 40; row++) {
    for (let column = 1; column < 16; column += 2) {
      const offset = (row * 16 + column) * 3;
      stripes.fill(255, offset, offset + 3);
    }
  }
  const photo = await sharp({ create: { width: 1840, height: 1000, channels: 3, background: '#fc1010' } })
    .composite([{ input: stripes, raw: { width: 16, height: 40, channels: 3 }, left: 500, top: 480 }])
    .png().toBuffer();
  const uploadImage = (input, type = '') => {
    const form = new FormData();
    form.set('image', new Blob([input], { type: 'image/png' }), 'sample.png');
    form.set('altText', 'Fixture product');
    return fetch(`${base}/api/upload${type ? `?type=${type}` : ''}`, { method: 'POST', body: form });
  };

  const response = await uploadImage(photo, 'product');
  assert.equal(response.status, 200);
  const image = await response.json();
  assert.match(image.url, /^\/uploads\/product-frames\/v3-/);
  assert.deepEqual([image.width, image.height], [2278, 2762]);
  assert.equal(image.altText, 'Fixture product');
  const served = await fetch(base + image.url);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await served.arrayBuffer());
  assert.equal(bytes.length, image.size);
  const dimensions = await sharp(bytes).metadata();
  assert.deepEqual([dimensions.width, dimensions.height], [image.width, image.height]);
  assert.equal(dimensions.chromaSubsampling, '4:4:4');
  const detail = await sharp(bytes).extract({ left: 719, top: 1190, width: 16, height: 1 }).greyscale().raw().toBuffer();
  assert.ok(detail.every((value, i) => i % 2 ? value > 200 : value < 50), 'The compositor resolves single-pixel lines from a high-resolution upload');
  const center = await sharp(bytes).extract({ left: 1138, top: 1190, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(center[0] > 230 && center[1] < 40);
  const footer = await sharp(bytes).extract({ left: 1138, top: 2370, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(footer.some(value => value < 230));
  assert.equal((await (await uploadImage(photo, 'product')).json()).url, image.url);
  assert.equal((await uploadImage(Buffer.from('corrupt'), 'product')).status, 400);
  const rejected = await uploadImage(banner, 'product');
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: BANNER_IMAGE_ERROR });
  assert.deepEqual((await fs.readdir(uploads)).sort(), ['category.png', 'product-frames']);
  assert.deepEqual(await fs.readdir(path.join(uploads, 'product-frames')), [path.basename(image.url)]);

  const generalResponse = await uploadImage(photo);
  assert.equal(generalResponse.status, 200);
  const { url } = await generalResponse.json();
  assert.match(url, /^\/uploads\/general-image-/);
  const original = await fetch(base + url);
  assert.equal(original.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), photo);
});

async function waitForBatch(service) {
  for (let i = 0; i < 240; i++) {
    const state = await service.status();
    if (state.status !== 'running') return state;
    await delay(100);
  }
  throw new Error('Timed out waiting for the test batch');
}

test('frames 50 image slots, resumes after cleanup interruption and deletes only unreferenced originals', {
  skip: !database && 'Set PRODUCT_FRAME_TEST_DATABASE_URL to a local PostgreSQL database',
}, async t => {
  const url = new URL(database);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'The test requires local PostgreSQL');
  const schema = `frame_test_${randomBytes(6).toString('hex')}`;
  url.searchParams.set('schema', schema);
  const tempRoot = path.resolve(os.tmpdir());
  const uploads = await fs.mkdtemp(path.join(tempRoot, 'vitahub-frame-test-'));
  const prisma = new PrismaClient({ datasourceUrl: url.href });
  t.after(async () => {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await prisma.$disconnect();
      assert.equal(path.dirname(path.resolve(uploads)), tempRoot);
      assert.match(path.basename(uploads), /^vitahub-frame-test-[a-zA-Z0-9]+$/);
      await fs.rm(uploads, { recursive: true, force: true });
    }
  });
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url.href },
    stdio: 'pipe',
  });

  for (const [name, background] of [['front.png', '#fc1010'], ['shared.png', '#10fc10'], ['side.png', '#1010fc'], ['category-banner.png', '#f08000']]) {
    await sharp({ create: { width: 420, height: 270, channels: 3, background } }).png().toFile(path.join(uploads, name));
  }
  const gallery = Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? '/uploads/shared.png' : '/uploads/side.png');
  const category = await prisma.category.create({ data: { name: 'Fixture', image: '/uploads/category-banner.png' } });
  await prisma.offer.create({ data: { title: 'Fixture', discount: '10%', image: '/uploads/shared.png' } });
  const original = await prisma.product.create({
    data: { id: 'a', title: 'Gallery fixture', price: 15, categoryId: category.id, image: '/uploads/front.png', images: JSON.stringify(gallery) },
  });
  await fs.writeFile(path.join(uploads, 'corrupt.png'), 'invalid image');
  const externalSource = 'https://fixture.invalid/no-local-copy.jpg';
  await prisma.product.create({
    data: { id: 'b', title: 'Corrupt fixture', price: 25, categoryId: category.id, image: '/uploads/corrupt.png', images: JSON.stringify([externalSource]) },
  });
  const previousFrameUrl = `/uploads/product-frames/v2-${'a'.repeat(64)}.jpg`;
  const previousFrame = framedPath(previousFrameUrl, uploads);
  await fs.mkdir(path.dirname(previousFrame), { recursive: true });
  await sharp({ create: { width: 1139, height: 1381, channels: 3, background: '#f08' } }).jpeg().toFile(previousFrame);
  await prisma.product.create({
    data: { id: 'legacy', title: 'Already framed', price: 20, categoryId: category.id, image: previousFrameUrl },
  });
  const template = await fs.readFile(path.join(__dirname, '../assets/frame.png'));
  const banner = await fs.readFile(path.join(uploads, 'category-banner.png'));
  const bannerHash = createHash('sha256').update(createHash('sha256').update(template).digest()).update(banner).digest('hex');
  const blockedFrame = `/uploads/product-frames/v2-${bannerHash}.jpg`;
  await fs.copyFile(previousFrame, framedPath(blockedFrame, uploads));
  const blockedProduct = await prisma.product.create({
    data: { id: 'banner', title: 'Already framed category artwork', price: 19, categoryId: category.id, image: blockedFrame },
  });
  const artwork = await loadProductArtwork(prisma, { uploadsDir: uploads });
  assert.equal(artwork.excludes('https://api.the-vitahub.com/uploads/category-banner.png?v=1'), true);
  assert.equal(artwork.excludes(`/uploads/product-frames/v3-${bannerHash}.jpg`), true);
  assert.equal(artwork.excludes(previousFrameUrl), false);
  assert.equal(hideProductArtwork(blockedProduct, artwork.excludes).image, '');

  const cacheName = product => {
    const hash = createHash('sha256').update(JSON.stringify([product.image, JSON.parse(product.images)])).digest('hex').slice(0, 16);
    return path.join(uploads, 'catalog-cache', `a_g49_${hash}_square-v1.jpg`);
  };
  await fs.mkdir(path.join(uploads, 'catalog-cache'));
  await fs.copyFile(path.join(uploads, 'side.png'), cacheName(original));

  const interruptedService = createProductFrameService({
    setting: prisma.setting,
    product: prisma.product,
    category: prisma.category,
    hero: prisma.hero,
    $transaction: prisma.$transaction.bind(prisma),
    $queryRaw: async () => { throw new Error('Fixture interruption before cleanup'); },
  }, { uploadsDir: uploads });
  const service = createProductFrameService(prisma, { uploadsDir: uploads });
  const app = express();
  app.use(express.json());
  app.use('/uploads', express.static(uploads), retiredUploadHandler(uploads));
  const index = await fs.readFile(path.join(__dirname, '../index.js'), 'utf8');
  const routes = index.slice(index.indexOf("app.get('/api/admin/settings/product-frames'"), index.indexOf('const ALLOWED_SETTINGS_KEYS'));
  vm.runInNewContext(routes, {
    app,
    productFrames: interruptedService,
    adminAuthenticate: (req, res, next) => req.headers.authorization === 'Bearer test-admin' ? next() : res.sendStatus(401),
    sendSafeError: (res, error) => res.status(500).send(error.message),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${base}/api/admin/settings/product-frames`;
  const startRequest = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: null }) };
  assert.equal((await fetch(endpoint, startRequest)).status, 401);
  const response = await fetch(endpoint, { ...startRequest, headers: { ...startRequest.headers, Authorization: 'Bearer test-admin' } });
  assert.equal(response.status, 202);
  const first = await response.json();
  assert.equal((await service.start(null)).revision, first.revision);

  const interrupted = await waitForBatch(interruptedService);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.attempted, 50);
  assert.equal(interrupted.merged, 50);
  await fs.access(path.join(uploads, 'front.png'));
  const partial = await prisma.product.findUniqueOrThrow({ where: { id: 'a' } });
  const partialGallery = JSON.parse(partial.images);
  assert.equal(partialGallery.length, 50);
  assert.equal(partialGallery[49], gallery[49]);
  assert.equal(partialGallery.slice(0, 49).filter(url => framedPath(url, uploads)).length, 49);
  await fs.access(cacheName(partial));
  assert.equal(partial.imageWidth, 2278);
  assert.equal(partial.imageHeight, 2762);
  assert.equal(partial.price, 15);

  const ready = await service.start(interrupted.revision).then(() => waitForBatch(service));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.merged, 50);
  assert.equal(ready.deleted, 1);
  assert.equal(await readFrameAlias(uploads, 'front.png'), partial.image);
  await assert.rejects(fs.access(path.join(uploads, 'front.png')), { code: 'ENOENT' });
  const [oldLink, newLink] = await Promise.all([
    fetch(`${base}/uploads/front.png`), fetch(`${base}${partial.image}`),
  ]);
  assert.equal(oldLink.status, 200);
  assert.equal(newLink.status, 200);
  assert.equal(oldLink.headers.get('content-type'), 'image/jpeg');
  assert.equal(newLink.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await oldLink.arrayBuffer()), Buffer.from(await newLink.arrayBuffer()));
  await fs.access(path.join(uploads, 'side.png'));
  await fs.access(path.join(uploads, 'shared.png'));

  const result = await service.start(ready.revision).then(() => waitForBatch(service));
  assert.equal(result.status, 'retry');
  assert.equal(result.attempted, 4);
  assert.equal(result.merged, 1);
  assert.equal(result.totalMerged, 51);
  assert.equal(result.deleted, 2);
  assert.equal(result.passFailed, 3);
  assert.equal(result.failures.find(failure => failure.productId === 'banner')?.message, BANNER_IMAGE_ERROR);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'banner' } })).image, blockedFrame);
  await fs.access(path.join(uploads, 'category-banner.png'));
  await assert.rejects(fs.access(path.join(uploads, 'side.png')), { code: 'ENOENT' });
  await fs.access(path.join(uploads, 'shared.png'));
  await fs.access(path.join(uploads, 'corrupt.png'));
  const current = await prisma.product.findUniqueOrThrow({ where: { id: 'a' } });
  const finalGallery = JSON.parse(current.images);
  assert.deepEqual(finalGallery.slice(0, 49), partialGallery.slice(0, 49));
  assert.equal(finalGallery[49], finalGallery[1]);
  assert.equal(current.image, partial.image);
  const failures = await prisma.product.findUniqueOrThrow({ where: { id: 'b' } });
  assert.equal(failures.image, '/uploads/corrupt.png');
  assert.equal(failures.images, JSON.stringify([externalSource]));

  async function pixel(url, x, y) {
    return sharp(framedPath(url, uploads)).extract({ left: x * 2, top: y * 2, width: 1, height: 1 }).raw().toBuffer();
  }
  for (const [url, channel] of [[current.image, 0], [finalGallery[0], 1], [finalGallery[49], 2]]) {
    const center = await pixel(url, 569, 595);
    assert.ok(center[channel] > 230 && center[(channel + 1) % 3] < 40 && center[(channel + 2) % 3] < 40);
    const footer = await pixel(url, 569, 1185);
    assert.ok(footer.some(value => value < 230), 'The frame footer is still visible');
  }
  const retried = await service.start(result.revision).then(() => waitForBatch(service));
  assert.equal(retried.merged, 0);
  assert.equal(retried.totalMerged, 51);
  assert.equal(retried.attempted, 3);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'legacy' } })).image, previousFrameUrl);

  await fs.copyFile(path.join(uploads, 'shared.png'), path.join(uploads, 'concurrent.png'));
  await prisma.product.create({
    data: { id: 'c', title: 'Concurrent edit', price: 35, categoryId: category.id, image: '/uploads/concurrent.png' },
  });
  const updatedGallery = JSON.stringify(['/uploads/shared.png']);
  const racingService = createProductFrameService({
    setting: prisma.setting,
    product: prisma.product,
    category: prisma.category,
    hero: prisma.hero,
    $queryRaw: prisma.$queryRaw.bind(prisma),
    $transaction: async commit => {
      await prisma.product.update({ where: { id: 'c' }, data: { images: updatedGallery } });
      return prisma.$transaction(commit);
    },
  }, { uploadsDir: uploads });
  const raced = await racingService.start(retried.revision).then(() => waitForBatch(racingService));
  assert.equal(raced.merged, 0);
  assert.ok(raced.failures.some(failure => failure.productId === 'c'));
  const edited = await prisma.product.findUniqueOrThrow({ where: { id: 'c' } });
  assert.equal(edited.image, '/uploads/concurrent.png');
  assert.equal(edited.images, updatedGallery);
  await fs.access(path.join(uploads, 'concurrent.png'));

  const where = { key: FRAME_JOB_KEY };
  const { reviewId, ...oldJob } = JSON.parse((await prisma.setting.findUniqueOrThrow({ where })).value);
  await prisma.setting.update({
    where,
    data: { value: JSON.stringify({ ...oldJob, status: 'ready', cursor: { id: 'zz', slot: 0 }, passFailed: 600 }) },
  });

  const frontUrl = 'https://cdn.shopify.com/exact-front.png?v=1';
  const backUrl = 'https://cdn.shopify.com/exact-back.png?v=2';
  const unavailable = 'https://cdn.shopify.com/unavailable.png';
  await prisma.product.createMany({ data: [
    ...Array.from({ length: 54 }, (_, i) => ({ id: `missing-${i}`, title: `Missing photo ${i}`, price: 12, categoryId: category.id, image: '' })),
    { id: 'z-remote', title: 'Remote photos', price: 42, categoryId: category.id, image: frontUrl, images: JSON.stringify([backUrl, unavailable]) },
  ] });
  const requests = [];
  const remoteService = createProductFrameService(prisma, {
    uploadsDir: uploads,
    request: async url => {
      requests.push(url.href);
      if (url.href === unavailable) return new Response(null, { status: 404 });
      const bytes = url.href === frontUrl
        ? await fs.readFile(path.join(uploads, 'shared.png'))
        : await sharp({ create: { width: 420, height: 270, channels: 3, background: '#1010fc' } }).png().toBuffer();
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    },
  });
  const full = await remoteService.start(raced.revision, true).then(() => waitForBatch(remoteService));
  assert.equal(full.status, 'retry');
  assert.equal(full.passFailed, 58);
  assert.equal(full.passAttempted, 62);
  assert.deepEqual(requests, [frontUrl, backUrl, unavailable]);
  const remote = await prisma.product.findUniqueOrThrow({ where: { id: 'z-remote' } });
  const remoteGallery = JSON.parse(remote.images);
  assert.match(remote.image, /^\/uploads\/product-frames\/v3-/);
  assert.match(remoteGallery[0], /^\/uploads\/product-frames\/v3-/);
  assert.notEqual(remote.image, remoteGallery[0]);
  assert.ok((await pixel(remote.image, 569, 595))[1] > 230);
  assert.ok((await pixel(remoteGallery[0], 569, 595))[2] > 230);
  assert.equal(remoteGallery[1], unavailable);
  assert.equal(remote.price, 42);
  const firstReview = await remoteService.review(1);
  const secondReview = await remoteService.review(2);
  assert.equal(firstReview.entries.length, 50);
  assert.equal(secondReview.entries.length, 8);
  assert.equal(secondReview.recorded, full.passFailed);
  assert.equal(new Set([...firstReview.entries, ...secondReview.entries].map(({ productId, slot }) => `${productId}:${slot}`)).size, 58);
});
