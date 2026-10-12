const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const AdmZip = require('adm-zip');
const { Prisma } = require('@prisma/client');
const { generateFullStoreBackup, restoreFullStoreBackup } = require('../src/services/backupService');

const models = Prisma.dmmf.datamodel.models;
const delegate = name => name[0].toLowerCase() + name.slice(1);

function temporaryUploads(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vitahub-backup-test-'));
  t.after(() => {
    const target = path.resolve(folder);
    assert.ok(target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(target).startsWith('vitahub-backup-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return folder;
}

function fixtures() {
  const rows = Object.fromEntries(models.map(model => [delegate(model.name), []]));
  const productModel = models.find(model => model.name === 'Product');
  const product = Object.fromEntries(productModel.fields.filter(field => field.kind !== 'object').map(field => [field.name,
    field.type === 'DateTime' ? new Date('2026-01-02T03:04:05Z')
      : ['Int', 'Float'].includes(field.type) ? 12 : `بيانات ${field.name}`
  ]));
  Object.assign(product, {
    id: 'product-fixture', title: 'منتج تجريبي', desc: 'وصف كامل '.repeat(1000),
    categoryId: 'category-fixture', brandId: 'brand-fixture', oldPrice: 0, discountValue: 0,
    image: '/uploads/front.jpg', images: '["/uploads/back.jpg"]',
    supplementFacts: JSON.stringify({ servingSize: '1 capsule', rows: [{ label: 'Vitamin C', amount: '100 mg', dv: '111%' }] }),
    dosageCalculator: JSON.stringify({ enabled: true, rules: [{ label: 'rule', dose: 1 }] }),
    faqs: JSON.stringify([{ question_ar: 'سؤال', answer_ar: 'إجابة' }]),
  });
  rows.product = [product];
  rows.category = [{ id: 'category-fixture', name: 'قسم', createdAt: new Date('2026-01-01') }];
  rows.brand = [{ id: 'brand-fixture', name: 'ماركة', createdAt: new Date('2026-01-01') }];
  rows.user = [{ id: 'user-fixture', email: 'fixture@example.test', password: 'fixture-hash', role: 'customer', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }];
  rows.order = [{ id: 'order-fixture', orderNumber: 'TEST-1', userId: 'user-fixture', customerName: 'عميل', customerPhone: 'fixture-phone', governorate: 'fixture-region', district: 'fixture-district', address: 'fixture-address', total: 12 }];
  rows.orderItem = [{ id: 'item-fixture', orderId: 'order-fixture', productId: product.id, title: product.title, price: 12, quantity: 1 }];
  rows.setting = [{ key: 'test_setting', value: '{"enabled":true}', updatedAt: new Date('2026-01-01') }];
  rows.auditLog = [{ id: 'audit-fixture', action: 'fixture-action', userId: 'user-fixture', details: 'fixture-details', createdAt: new Date('2026-01-01') }];
  rows.revokedToken = [{ id: 'revoked-fixture', tokenHash: 'fixture-hash', expiresAt: new Date('2030-01-01'), createdAt: new Date('2026-01-01') }];
  rows.pixelEvent = Array.from({ length: 2005 }, (_, i) => ({ id: `pixel-${i}`, eventName: 'PageView', createdAt: new Date('2026-01-01') }));
  rows.indexingLog = Array.from({ length: 1005 }, (_, i) => ({ id: `index-${i}`, url: 'https://example.test/product', action: 'URL_UPDATED', status: 'success', createdAt: new Date('2026-01-01') }));
  return rows;
}

function database(rows) {
  const inserted = {};
  const transactions = [];
  const prisma = Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, {
    async findMany(args) { return structuredClone(args?.take ? records.slice(0, args.take) : records); },
    async deleteMany() { inserted[name] = []; },
    async createMany({ data }) { (inserted[name] ??= []).push(...data); },
    async create({ data }) { (inserted[name] ??= []).push(data); },
  }]));
  prisma.$transaction = async (callback, options) => { transactions.push(options); return callback(prisma); };
  return { prisma, inserted, transactions };
}

test('data ZIP contains every product field and all records, with readable table files', async t => {
  const rows = fixtures();
  rows.additionalModel = [{ id: 'extra-fixture', value: 'extra-data' }];
  const db = database(rows);
  const uploads = temporaryUploads(t);
  fs.writeFileSync(path.join(uploads, 'front.jpg'), 'fixture-image');
  const zip = new AdmZip(await generateFullStoreBackup(db.prisma, uploads, { includeMedia: false }));
  const data = JSON.parse(zip.readAsText('database.json'));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.deepEqual(data, JSON.parse(JSON.stringify(rows)));
  assert.deepEqual(JSON.parse(zip.readAsText('tables/product.json')), data.product);
  assert.equal(data.pixelEvent.length, 2005);
  assert.equal(data.indexingLog.length, 1005);
  assert.equal(data.additionalModel[0].value, 'extra-data');
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.fields.product.sort(), Object.keys(rows.product[0]).sort());
  assert.equal(manifest.totalRecords, Object.values(rows).reduce((sum, records) => sum + records.length, 0));
  assert.equal(manifest.uploadedFilesCount, 0);
  assert.ok(!zip.getEntries().some(entry => entry.entryName.startsWith('uploads/')));
  assert.match(zip.readAsText('README.txt'), /tables\/product.json/);
  assert.equal(db.transactions[0].isolationLevel, 'RepeatableRead');
});

test('full ZIP has the same complete database plus uploaded files', async t => {
  const rows = fixtures();
  const uploads = temporaryUploads(t);
  fs.mkdirSync(path.join(uploads, 'nested'));
  fs.writeFileSync(path.join(uploads, 'front.jpg'), 'fixture-image');
  fs.writeFileSync(path.join(uploads, 'nested', 'back.jpg'), 'fixture-back-image');
  const zip = new AdmZip(await generateFullStoreBackup(database(rows).prisma, uploads));
  assert.deepEqual(JSON.parse(zip.readAsText('database.json')), JSON.parse(JSON.stringify(rows)));
  assert.equal(zip.readAsText('uploads/nested/back.jpg'), 'fixture-back-image');
  assert.equal(JSON.parse(zip.readAsText('manifest.json')).uploadedFilesCount, 2);
});

test('a database query failure rejects the backup rather than exporting an empty table', async t => {
  const db = database(fixtures());
  db.prisma.product.findMany = async () => { throw new Error('fixture database error'); };
  await assert.rejects(generateFullStoreBackup(db.prisma, temporaryUploads(t), { includeMedia: false }), /reading table "product"/);
});

test('export and restore preserve every product field, order links and audit records', async t => {
  const rows = fixtures();
  const uploads = temporaryUploads(t);
  const archive = await generateFullStoreBackup(database(rows).prisma, uploads, { includeMedia: false });
  const target = database(fixtures());
  await restoreFullStoreBackup(target.prisma, archive, uploads);
  assert.deepEqual(JSON.parse(JSON.stringify(target.inserted.product)), JSON.parse(JSON.stringify(rows.product)));
  assert.equal(target.inserted.order[0].userId, 'user-fixture');
  assert.equal(target.inserted.auditLog[0].details, 'fixture-details');
  assert.equal(target.inserted.revokedToken[0].tokenHash, 'fixture-hash');
});

test('incomplete and inconsistent ZIPs are rejected before restoring any database rows', async t => {
  const target = database(fixtures());
  const uploads = temporaryUploads(t);
  const missing = new AdmZip();
  missing.addFile('database.json', Buffer.from('{}'));
  await assert.rejects(restoreFullStoreBackup(target.prisma, missing.toBuffer(), uploads), /required database tables/);
  const inconsistent = new AdmZip();
  inconsistent.addFile('database.json', Buffer.from(JSON.stringify(fixtures())));
  inconsistent.addFile('manifest.json', Buffer.from(JSON.stringify({ tables: { product: 50 } })));
  await assert.rejects(restoreFullStoreBackup(target.prisma, inconsistent.toBuffer(), uploads), /record count mismatch/);
  assert.equal(target.transactions.length, 0);
});
