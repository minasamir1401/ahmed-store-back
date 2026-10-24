const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');

function harness(product, legacy) {
  const files = new Map();
  const cache = path.resolve(__dirname, '../uploads/catalog-cache');
  if (legacy) files.set(path.join(cache, `${product.id}.jpg`), legacy);
  const context = vm.createContext({
    exports: {}, module: { exports: {} }, __dirname: path.resolve(__dirname, '../src/services'),
    Buffer, AbortSignal, console,
    fetch: async () => { throw new Error('Remote image unavailable'); },
    require(name) {
      if (name === 'fs') return {
        existsSync: file => file === cache || files.has(file),
        mkdirSync() {},
        promises: {
          stat: async file => ({ size: files.get(file).buffer.length, mtimeMs: files.get(file).time }),
          copyFile: async (from, to) => files.set(to, files.get(from)),
          writeFile: async (file, buffer) => files.set(file, { buffer, time: Date.now() }),
          readFile: async file => files.get(file).buffer,
        },
      };
      if (name === '../utils/productImages') return require('../src/utils/productImages');
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/services/catalogImageService.js'), 'utf8'), context);
  return {
    files,
    setFetch(fn) { context.fetch = fn; },
    async request() {
      const headers = {};
      let file;
      let body;
      const res = {
        setHeader: (key, value) => { headers[key] = value; },
        status: () => res,
        send: buffer => { body = buffer; },
        sendFile: name => { file = name; },
      };
      await context.module.exports.serveCatalogProductImage({ params: { productId: `${product.id}.jpg` } }, res, { product: { findUnique: async () => product } });
      return { file, body, headers };
    },
  };
}

test('existing valid cached photos survive deployment even when the external source is unavailable', async () => {
  const buffer = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  // The production cache requires at least 500 bytes.
  const cached = Buffer.concat([buffer, Buffer.alloc(600)]);
  const product = { id: 'migration', image: 'https://remote.example/front.jpg', images: null, updatedAt: new Date('2026-10-12') };
  const service = harness(product, { buffer: cached, time: Date.parse('2026-10-19') });
  const response = await service.request();
  assert.equal(response.headers['X-Catalog-Image-Cache'], 'HIT');
  assert.match(response.file, /migration_[a-f0-9]{16}\.jpg$/);
  assert.deepEqual(service.files.get(response.file).buffer, cached);
});

test('changing a saved image generates a new cached JPEG instead of returning the old photo', async () => {
  const oldBuffer = Buffer.alloc(700, 1);
  const product = { id: 'replacement', image: 'https://remote.example/new.jpg', images: null, updatedAt: new Date('2026-10-24') };
  const service = harness(product, { buffer: oldBuffer, time: Date.parse('2026-10-19') });
  const newBuffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#00ff00' } }).png().toBuffer();
  let fetches = 0;
  service.setFetch(async () => { fetches++; return { ok: true, arrayBuffer: async () => newBuffer }; });
  const response = await service.request();
  assert.equal(response.headers['X-Catalog-Image-Cache'], 'MISS');
  assert.equal((await sharp(response.body).metadata()).format, 'jpeg');
  assert.notDeepEqual(response.body, oldBuffer);
  const oldKey = [...service.files.keys()].find(key => key.includes('replacement_'));
  product.image = 'https://remote.example/newer.jpg';
  await service.request();
  assert.equal(fetches, 2);
  assert.equal([...service.files.keys()].filter(key => key.includes('replacement_')).length, 2);
  assert.ok(service.files.has(oldKey));
});
