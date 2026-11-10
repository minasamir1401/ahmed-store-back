const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const XLSX = require('xlsx');
const { parseProductsFromWorkbook, importProductsFromExcel, startExcelImportJob, getExcelImportJob } = require('../src/services/excelImportService');
const tempRoot = fs.existsSync(path.join(os.tmpdir(), 'kilo')) ? path.join(os.tmpdir(), 'kilo') : os.tmpdir();

function workbook(t, rows, bookType = 'xlsx') {
  const folder = fs.mkdtempSync(path.join(tempRoot, 'vitahub-excel-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, `products.${bookType}`);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Products');
  XLSX.writeFile(book, file, { bookType });
  return file;
}

function rows(count = 50) {
  return [
    ['English Title', 'Arabic Title', 'Current Price (EGP)', 'Company', 'Category', 'Front Image URL'],
    ...Array.from({ length: count }, (_, i) => [`Product ${i + 1}`, `Title ${i + 1}`, 100 + i, 'Test', 'Test category', `https://unavailable.test/${i + 1}.jpg`]),
  ];
}

function database(products = []) {
  const stored = new Map(products.map((product, i) => [product.id || `product-${i}`, { price: 999, ...product, id: product.id || `product-${i}` }]));
  const settings = new Map();
  const categories = [{ id: 'category', name: 'Test category', image: '/uploads/category.jpg' }];
  const brands = [{ id: 'brand', name: 'Test' }];
  const updates = [];
  const creates = [];
  let writeGate = Promise.resolve();
  const lookup = records => ({
    findMany: async () => structuredClone(records),
    async upsert({ where, create }) {
      const existing = records.find(record => record.name === where.name);
      if (existing) return existing;
      const record = { ...create, id: `${records === categories ? 'category' : 'brand'}-${records.length}` };
      records.push(record);
      return record;
    },
    async update({ where, data }) {
      const record = records.find(item => item.id === where.id);
      Object.assign(record, data);
      return record;
    },
  });
  const prisma = {
    category: lookup(categories),
    hero: { findUnique: async () => null },
    brand: lookup(brands),
    product: {
      findMany: async () => [...stored.values()].map(({ id, title, titleEn }) => ({ id, title, titleEn })),
      async update({ where, data }) {
        updates.push({ id: where.id, data });
        await writeGate;
        const record = stored.get(where.id);
        assert.ok(record, 'update must target an existing product');
        Object.assign(record, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
        return { ...record };
      },
      async create({ data }) {
        await writeGate;
        const record = { ...data, id: `created-${creates.length}` };
        creates.push(record);
        stored.set(record.id, record);
        return record;
      },
      count: async ({ where }) => [...stored.values()].filter(product => product.categoryId === where.categoryId).length,
    },
    setting: {
      findUnique: async ({ where }) => structuredClone(settings.get(where.key) || null),
      async create({ data }) {
        if (settings.has(data.key)) throw Object.assign(new Error('duplicate key'), { code: 'P2002' });
        const record = { ...data, updatedAt: new Date() };
        settings.set(data.key, record);
        return record;
      },
      async updateMany({ where, data }) {
        const record = settings.get(where.key);
        if (!record || record.value !== where.value) return { count: 0 };
        Object.assign(record, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
  };
  return { prisma, stored, settings, updates, creates, setWriteGate: gate => { writeGate = gate; } };
}

async function importApi(t, prisma, onComplete = () => {}) {
  const express = require('express');
  const folder = fs.mkdtempSync(path.join(tempRoot, 'vitahub-excel-http-'));
  const app = express();
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const uploadStart = source.indexOf('const excelUpload = multer({');
  const uploadEnd = source.indexOf('\n});', uploadStart) + '\n});'.length;
  const routeStart = source.indexOf("app.get('/api/products/import-excel/status'");
  const routeEnd = source.indexOf("app.patch('/api/products/:id'", routeStart);
  const context = vm.createContext({
    app, prisma, path, fs, console, AbortController, setInterval, clearInterval,
    multer: require('multer'), crypto: require('node:crypto'),
    adminAuthenticate(req, res, next) {
      if (!req.get('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
      req.user = { id: req.get('Authorization').slice('Bearer '.length), role: 'admin' };
      next();
    },
    invalidateCatalogCache: onComplete,
    sendSafeError: (res, error) => res.status(error.status || 500).json({ error: error.message }),
    require(name) {
      if (name === 'node:os') return { tmpdir: () => folder };
      if (name === './src/services/excelImportService') return require('../src/services/excelImportService');
      return require(name);
    },
  });
  vm.runInContext(`${source.slice(uploadStart, uploadEnd)}\n${source.slice(routeStart, routeEnd)}`, context);
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}/api/products/import-excel`;
}

test('all supported workbook formats parse 50 products without losing rows', t => {
  for (const format of ['xlsx', 'xls', 'xlsm', 'csv']) {
    const products = parseProductsFromWorkbook(workbook(t, rows(), format));
    assert.equal(products.length, 50, format);
    assert.equal(products[49].price, 149, format);
    assert.equal(products[0].image, 'https://unavailable.test/1.jpg', format);
  }
});

test('a 50-product workbook updates matching catalog records without image requests', async t => {
  const suppliedFile = path.resolve(__dirname, '../../vitamin_hub_products_batch_1_images_updated.xlsx');
  const file = fs.existsSync(suppliedFile) ? suppliedFile : workbook(t, rows());
  const products = parseProductsFromWorkbook(file);
  assert.equal(products.length, 50);
  const db = database(products.map((product, i) => ({ id: `existing-${i}`, title: product.title, titleEn: product.titleEn })));
  const progress = [];
  const originalFetch = global.fetch;
  global.fetch = async () => { assert.fail('Excel import must not download remote product images'); };
  t.after(() => { global.fetch = originalFetch; });
  const result = await importProductsFromExcel(file, db.prisma, { onProgress: event => progress.push(event.processedCount) });
  assert.equal(result.totalRows, 50);
  assert.equal(result.updatedCount, 50);
  assert.equal(result.importedCount, 0);
  assert.equal(db.updates.length, 50);
  assert.equal(db.creates.length, 0);
  assert.deepEqual(progress, [0, 15, 30, 45, 50]);
  for (let i = 0; i < products.length; i++) {
    assert.equal(db.stored.get(`existing-${i}`).image, products[i].image);
  }
});

test('Prisma build JSON manifests parse as raw UTF-8 without a BOM', () => {
  for (const name of ['package.json', 'package-lock.json']) {
    const content = fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
    assert.doesNotThrow(() => JSON.parse(content), `${name} must be valid JSON without a leading BOM`);
  }
});

test('missing prices preserve existing prices while an explicit zero is imported', async t => {
  const file = workbook(t, [['Title', 'Price'], ['Keep existing', null], ['Set zero', 0], ['New product', null]]);
  const db = database([{ id: 'keep', title: 'Keep existing' }, { id: 'zero', title: 'Set zero' }]);
  const result = await importProductsFromExcel(file, db.prisma);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.importedCount, 1);
  assert.equal(db.stored.get('keep').price, 999);
  assert.equal(db.stored.get('zero').price, 0);
  assert.equal(db.creates[0].price, 0);
  assert.equal(db.creates[0].image, '');
});

test('Excel import preserves a product image when the spreadsheet points to category artwork', async t => {
  const file = workbook(t, [
    ['English Title', 'Category', 'Front Image URL'],
    ['Existing product', 'Test category', 'https://api.the-vitahub.com/uploads/category.jpg'],
    ['New product', 'Test category', '/uploads/category.jpg'],
  ]);
  const db = database([{ id: 'existing', title: 'Existing product', image: '/uploads/actual-product.jpg' }]);
  const result = await importProductsFromExcel(file, db.prisma);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.importedCount, 1);
  assert.equal(db.stored.get('existing').image, '/uploads/actual-product.jpg');
  assert.equal(db.creates[0].image, '');
});

test('a background job returns before writes, persists final status and removes its private upload', async t => {
  const file = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(file));
  let release;
  db.setWriteGate(new Promise(resolve => { release = resolve; }));
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  const accepted = await startExcelImportJob(file, db.prisma, { ownerId: 'admin', jobId: 'job-50', onComplete: complete });
  assert.equal(accepted.status, 'running');
  assert.equal(db.updates.length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await getExcelImportJob(db.prisma, 'admin', 'job-50')).status, 'running');
  assert.equal(await getExcelImportJob(db.prisma, 'other-admin', 'job-50'), null);
  release();
  await finished;
  const job = await getExcelImportJob(db.prisma, 'admin', 'job-50');
  assert.equal(job.status, 'completed');
  assert.equal(job.result.updatedCount, 50);
  assert.equal(job.result.importedCount, 0);
  assert.equal(db.updates.length, 50);
  assert.equal(fs.existsSync(file), false);
});

test('concurrent different files are explicitly rejected instead of reporting another file as imported', async t => {
  const firstFile = workbook(t, rows());
  const secondFile = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(firstFile));
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  const outcomes = await Promise.allSettled([
    startExcelImportJob(firstFile, db.prisma, { ownerId: 'admin', jobId: 'first', onComplete: complete }),
    startExcelImportJob(secondFile, db.prisma, { ownerId: 'admin', jobId: 'second', onComplete: complete }),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected').reason;
  assert.equal(rejected.status, 409);
  assert.equal(rejected.jobId, outcomes.find(outcome => outcome.status === 'fulfilled').value.jobId);
  await finished;
  assert.equal(db.updates.length, 50);
  assert.equal(db.creates.length, 0);
  assert.equal(fs.existsSync(firstFile), false);
  assert.equal(fs.existsSync(secondFile), false);
});

test('repeating the same job ID is idempotent and never performs duplicate updates', async t => {
  const firstFile = workbook(t, rows());
  const secondFile = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(firstFile));
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  const outcomes = await Promise.all([
    startExcelImportJob(firstFile, db.prisma, { ownerId: 'admin', jobId: 'same', onComplete: complete }),
    startExcelImportJob(secondFile, db.prisma, { ownerId: 'admin', jobId: 'same', onComplete: complete }),
  ]);
  assert.equal(outcomes[0].jobId, outcomes[1].jobId);
  await finished;
  assert.equal(db.updates.length, 50);
});

test('invalid workbooks persist a failed status and clean up without writing products', async t => {
  const file = workbook(t, []);
  const db = database();
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  await startExcelImportJob(file, db.prisma, { ownerId: 'admin', jobId: 'empty', onComplete: complete });
  await finished;
  const job = await getExcelImportJob(db.prisma, 'admin', 'empty');
  assert.equal(job.status, 'failed');
  assert.match(job.error, /فارغ/);
  assert.equal(db.updates.length + db.creates.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test('stale jobs after a process restart are never reported complete or automatically replayed', async () => {
  const db = database();
  db.settings.set('excel-import:admin', { key: 'excel-import:admin', value: JSON.stringify({ jobId: 'stale', status: 'running' }), updatedAt: new Date(Date.now() - 11 * 60 * 1000) });
  const job = await getExcelImportJob(db.prisma, 'admin', 'stale');
  assert.equal(job.status, 'failed');
  assert.match(job.error, /راجع القائمة/);
  assert.equal(db.updates.length + db.creates.length, 0);
});

test('cancellation after a database batch waits for in-flight updates and does not start another batch', async t => {
  const file = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(file));
  const controller = new AbortController();
  await assert.rejects(importProductsFromExcel(file, db.prisma, {
    signal: controller.signal,
    onProgress: event => { if (event.processedCount === 15) controller.abort(new Error('test cancellation')); },
  }), /test cancellation/);
  assert.equal(db.updates.length, 15);
});

test('the actual upload filter accepts supported extensions but not arbitrary octet-stream files', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  const start = source.indexOf('const excelUpload = multer({');
  const end = source.indexOf('\n});', start) + '\n});'.length;
  const multer = options => options;
  multer.diskStorage = options => options;
  const context = vm.createContext({ multer, path, crypto: require('node:crypto'), require });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.options = excelUpload;`, context);
  for (const originalname of ['products.xlsx', 'products.xls', 'products.xlsm', 'products.csv', 'PRODUCTS.XLSX']) {
    context.options.fileFilter({}, { originalname, mimetype: 'application/octet-stream' }, (error, accepted) => {
      assert.equal(error, null);
      assert.equal(accepted, true);
    });
  }
  context.options.fileFilter({}, { originalname: 'products.pdf', mimetype: 'application/octet-stream' }, error => assert.equal(error.status, 400));
  assert.equal(context.options.limits.fileSize, 200 * 1024 * 1024);
});

test('the real HTTP routes accept the upload, survive response closure and isolate status by admin', { timeout: 10000 }, async t => {
  const file = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(file));
  let release;
  db.setWriteGate(new Promise(resolve => { release = resolve; }));
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  const api = await importApi(t, db.prisma, complete);
  const jobId = require('node:crypto').randomUUID();
  const body = new FormData();
  body.append('file', new Blob([fs.readFileSync(file)]), 'products.xlsx');
  const accepted = await fetch(`${api}?async=1&jobId=${jobId}`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body });
  assert.equal(accepted.status, 202);
  await accepted.body.cancel();
  const running = await fetch(`${api}/status?jobId=${jobId}`, { headers: { Authorization: 'Bearer admin' } });
  assert.equal(running.status, 200);
  assert.equal((await running.json()).status, 'running');
  const secondBody = new FormData();
  secondBody.append('file', new Blob([fs.readFileSync(file)]), 'different-products.xlsx');
  const conflict = await fetch(`${api}?async=1&jobId=${require('node:crypto').randomUUID()}`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: secondBody });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).jobId, jobId);
  const other = await fetch(`${api}/status?jobId=${jobId}`, { headers: { Authorization: 'Bearer other-admin' } });
  assert.equal(other.status, 404);
  release();
  await finished;
  const final = await fetch(`${api}/status?jobId=${jobId}`, { headers: { Authorization: 'Bearer admin' } });
  const job = await final.json();
  assert.equal(job.status, 'completed');
  assert.equal(job.result.updatedCount, 50);
  assert.equal(db.updates.length, 50);
});

test('real multipart validation rejects unsupported names and retains the legacy streaming route', { timeout: 10000 }, async t => {
  const file = workbook(t, rows());
  const db = database(parseProductsFromWorkbook(file));
  const api = await importApi(t, db.prisma);
  const invalid = new FormData();
  invalid.append('file', new Blob(['fixture']), 'products.pdf');
  const rejected = await fetch(api, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: invalid });
  assert.equal(rejected.status, 400);
  const body = new FormData();
  body.append('file', new Blob([fs.readFileSync(file)]), 'products.xlsx');
  const response = await fetch(api, { method: 'POST', headers: { Authorization: 'Bearer admin', Accept: 'application/x-ndjson' }, body });
  assert.match(response.headers.get('Content-Type'), /application\/x-ndjson/);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type, 'started');
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).updatedCount, 50);
});
