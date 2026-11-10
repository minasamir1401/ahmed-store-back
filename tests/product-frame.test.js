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
const sharp = require('sharp');
const { createProductFrameService } = require('../src/services/productFrameService');
const { framedPath, readFrameAlias, retiredUploadHandler } = require('../src/utils/productFrameFiles');

const database = process.env.PRODUCT_FRAME_TEST_DATABASE_URL;

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

  for (const [name, background] of [['front.png', '#fc1010'], ['shared.png', '#10fc10'], ['side.png', '#1010fc']]) {
    await sharp({ create: { width: 420, height: 270, channels: 3, background } }).png().toFile(path.join(uploads, name));
  }
  const gallery = Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? '/uploads/shared.png' : '/uploads/side.png');
  const category = await prisma.category.create({ data: { name: 'Fixture', image: '/uploads/shared.png' } });
  const original = await prisma.product.create({
    data: { id: 'a', title: 'Gallery fixture', price: 15, categoryId: category.id, image: '/uploads/front.png', images: JSON.stringify(gallery) },
  });
  await fs.writeFile(path.join(uploads, 'corrupt.png'), 'invalid image');
  const externalSource = 'https://fixture.invalid/no-local-copy.jpg';
  await prisma.product.create({
    data: { id: 'b', title: 'Corrupt fixture', price: 25, categoryId: category.id, image: '/uploads/corrupt.png', images: JSON.stringify([externalSource]) },
  });

  const cacheName = product => {
    const hash = createHash('sha256').update(JSON.stringify([product.image, JSON.parse(product.images)])).digest('hex').slice(0, 16);
    return path.join(uploads, 'catalog-cache', `a_g49_${hash}_square-v1.jpg`);
  };
  await fs.mkdir(path.join(uploads, 'catalog-cache'));
  await fs.copyFile(path.join(uploads, 'side.png'), cacheName(original));

  const interruptedService = createProductFrameService({
    setting: prisma.setting,
    product: prisma.product,
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
  assert.equal(partial.imageWidth, 1139);
  assert.equal(partial.imageHeight, 1381);
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
  assert.equal(result.attempted, 3);
  assert.equal(result.merged, 1);
  assert.equal(result.totalMerged, 51);
  assert.equal(result.deleted, 2);
  assert.equal(result.passFailed, 2);
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
    return sharp(framedPath(url, uploads)).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
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
  assert.equal(retried.attempted, 2);

  await fs.copyFile(path.join(uploads, 'shared.png'), path.join(uploads, 'concurrent.png'));
  await prisma.product.create({
    data: { id: 'c', title: 'Concurrent edit', price: 35, categoryId: category.id, image: '/uploads/concurrent.png' },
  });
  const updatedGallery = JSON.stringify(['/uploads/shared.png']);
  const racingService = createProductFrameService({
    setting: prisma.setting,
    product: prisma.product,
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
});
