const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const sharp = require('sharp');
const { parseProductImages } = require('../utils/productImages');
const { UPLOADS_DIR, localUploadName, framedPath, aliasPath, readFrameAlias, writeAtomic } = require('../utils/productFrameFiles');
const { retainUnchangedImageCache } = require('./catalogImageService');
const { invalidateCatalogCache } = require('./catalogFeedService');

const FRAME_JOB_KEY = 'product-frame:v2';
const FRAME_FILE = path.resolve(__dirname, '../../assets/frame.png');
const BATCH_SIZE = 50;
const LEASE_MS = 120_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PIXELS = 32_000_000;
const TEMPLATE_WIDTH = 1139;
const TEMPLATE_HEIGHT = 1381;
const FRAME_SCALE = 2;
const FRAME_WIDTH = TEMPLATE_WIDTH * FRAME_SCALE;
const FRAME_HEIGHT = TEMPLATE_HEIGHT * FRAME_SCALE;
const SELECT_PRODUCT = { id: true, title: true, image: true, images: true, updatedAt: true };

class FrameSourceError extends Error {}
class ProductImagesChanged extends Error {}

function publicJob(record) {
  if (!record) return { status: 'idle', revision: null, limit: BATCH_SIZE };
  const { status, revision, attempted, merged, totalMerged, passFailed, failures, deleted, cleanupPending, error } = JSON.parse(record.value);
  return {
    status: status === 'running' && Date.now() - new Date(record.updatedAt).getTime() > LEASE_MS ? 'interrupted' : status,
    revision, limit: BATCH_SIZE, attempted, merged, totalMerged, passFailed, failures, deleted,
    cleanupPending: cleanupPending.length, error,
  };
}

async function prepareImage(source, frame, uploadsDir) {
  source = source.trim();
  const originalName = localUploadName(source);
  let original;
  let input;
  if (originalName) {
    if (originalName.toLowerCase() === 'logo-header.jpg') throw new FrameSourceError('المنتج يحتاج صورة أصلية بدل صورة المتجر الافتراضية.');
    const file = path.join(uploadsDir, originalName);
    const info = await fs.lstat(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!info) {
      const target = await readFrameAlias(uploadsDir, originalName);
      if (target) {
        try {
          await verifyOutput(framedPath(target, uploadsDir));
        } catch {
          throw new FrameSourceError('ملف الصورة البديلة مفقود أو تالف على السيرفر.');
        }
        return { url: target };
      }
    }
    if (!info?.isFile()) throw new FrameSourceError('ملف الصورة الأصلي غير موجود محليًا.');
    if (info.size > MAX_SOURCE_BYTES) throw new FrameSourceError('ملف الصورة أكبر من ٢٠ ميجابايت.');
    original = { name: originalName, size: info.size, modified: info.mtimeMs };
    input = await fs.readFile(file);
  } else if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) {
    const encoded = source.slice(source.indexOf(',') + 1);
    if (encoded.length > Math.ceil(MAX_SOURCE_BYTES * 4 / 3) + 4) {
      throw new FrameSourceError('ملف الصورة أكبر من ٢٠ ميجابايت.');
    }
    input = Buffer.from(encoded, 'base64');
  } else {
    throw new FrameSourceError('الصورة تحتاج نسخة أصلية محلية.');
  }

  const url = await saveFramedImage(input, frame, uploadsDir);
  return { url, original };
}

async function loadFrame(file) {
  const bytes = await fs.readFile(file);
  const template = sharp(bytes);
  const metadata = await template.metadata();
  if (metadata.width !== TEMPLATE_WIDTH || metadata.height !== TEMPLATE_HEIGHT) throw new Error('Unexpected product frame dimensions.');
  const { data, info } = await template.resize(FRAME_WIDTH, FRAME_HEIGHT)
    .flatten({ background: '#fff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info, digest: createHash('sha256').update(bytes).digest() };
}

let defaultFrame;
function getFrame(file = FRAME_FILE) {
  if (file !== FRAME_FILE) return loadFrame(file);
  if (!defaultFrame) {
    defaultFrame = loadFrame(file).catch(error => {
      defaultFrame = undefined;
      throw error;
    });
  }
  return defaultFrame;
}

async function saveFramedImage(input, frame, uploadsDir) {
  const digest = createHash('sha256').update(frame.digest).update(input).digest('hex');
  const url = `/uploads/product-frames/v3-${digest}.jpg`;
  const output = framedPath(url, uploadsDir);
  try {
    await verifyOutput(output);
    return url;
  } catch {
    // A retry can reuse a verified file left by an interrupted database write.
  }

  let photo;
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    if ((await image.metadata()).pages > 1) throw new FrameSourceError('الصورة متحركة أو متعددة الصفحات وتحتاج نسخة ثابتة.');
    photo = await image
      .rotate()
      .toColourspace('srgb')
      .resize({ width: 920 * FRAME_SCALE, height: 1000 * FRAME_SCALE, fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof FrameSourceError) throw error;
    throw new FrameSourceError('تعذر قراءة الصورة الأصلية أو تجاوزت حد الأبعاد الآمن.');
  }
  const jpeg = await sharp(frame.data, { raw: frame.info })
    .composite([{
      input: photo.data,
      raw: photo.info,
      left: Math.floor((FRAME_WIDTH - photo.info.width) / 2),
      top: Math.floor(595 * FRAME_SCALE - photo.info.height / 2),
    }])
    .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
    .toBuffer();
  await writeAtomic(output, jpeg);
  await verifyOutput(output);
  return url;
}

async function frameUploadedProductImage(input, uploadsDir = UPLOADS_DIR) {
  const frame = await getFrame();
  const url = await saveFramedImage(input, frame, uploadsDir);
  const { size } = await fs.stat(framedPath(url, uploadsDir));
  return { url, width: FRAME_WIDTH, height: FRAME_HEIGHT, size };
}

async function verifyOutput(file) {
  const metadata = await sharp(file).metadata();
  const legacy = path.basename(file).startsWith('v2-');
  const width = legacy ? TEMPLATE_WIDTH : FRAME_WIDTH;
  const height = legacy ? TEMPLATE_HEIGHT : FRAME_HEIGHT;
  if (metadata.format !== 'jpeg' || metadata.width !== width || metadata.height !== height) {
    throw new Error('The saved product frame is not a valid portrait JPEG.');
  }
}

async function removeReplacedUploads(prisma, pending, uploadsDir) {
  if (!pending.length) return 0;
  const unique = new Map(pending.map(entry => [entry.name, entry]));
  const candidates = [...unique.keys()].map(name => ({ name, encoded: encodeURIComponent(name) }));
  // Match filenames conservatively in saved references, including encoded URLs and JSON galleries.
  const inUse = await prisma.$queryRaw`
    WITH candidates AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb) AS items(name text, encoded text)
    ), refs AS (
      SELECT concat_ws(' ', image, images, "desc", "descEn", features, "featuresEn") AS value FROM "Product"
      UNION ALL SELECT image FROM "Category"
      UNION ALL SELECT image FROM "Brand"
      UNION ALL SELECT image FROM "Offer"
      UNION ALL SELECT concat_ws(' ', image, content, excerpt) FROM "Blog"
      UNION ALL SELECT concat_ws(' ', image, content, "contentEn") FROM "MedicalTip"
      UNION ALL SELECT concat_ws(' ', image, "side1Image", "side2Image", "prod1Image", "prod2Image", "prod3Image", "prod4Image", slides) FROM "Hero"
      UNION ALL SELECT image FROM "OrderItem"
      UNION ALL SELECT cart FROM "User"
      UNION ALL SELECT value FROM "Setting" WHERE key <> ${FRAME_JOB_KEY}
    )
    SELECT DISTINCT candidates.name FROM refs JOIN candidates
    ON strpos(lower(refs.value), lower(candidates.name)) > 0
    OR strpos(lower(refs.value), lower(candidates.encoded)) > 0
  `;
  const referenced = new Set(inUse.map(row => row.name));
  let deleted = 0;
  for (const [name, { url, size, modified }] of unique) {
    if (referenced.has(name) || localUploadName(`/uploads/${encodeURIComponent(name)}`) !== name) continue;
    const original = path.join(uploadsDir, name);
    try {
      const info = await fs.lstat(original);
      if (!info.isFile() || info.size !== size || info.mtimeMs !== modified) continue;
      // Keep cached pages and old direct links working after removing the original bytes.
      await verifyOutput(framedPath(url, uploadsDir));
      await writeAtomic(aliasPath(uploadsDir, name), url);
      await fs.unlink(original);
      deleted++;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (await readFrameAlias(uploadsDir, name) === url) deleted++;
    }
  }
  return deleted;
}

function createProductFrameService(prisma, { uploadsDir = UPLOADS_DIR, frameFile = FRAME_FILE } = {}) {
  let active = false;
  const where = { key: FRAME_JOB_KEY };
  const getRecord = () => prisma.setting.findUnique({ where });

  async function start(expectedRevision) {
    const previous = await getRecord();
    const current = publicJob(previous);
    if (active || current.status === 'running' || expectedRevision !== current.revision) return current;
    const saved = previous ? JSON.parse(previous.value) : null;
    const keepBatch = current.status === 'interrupted';
    const keepPass = keepBatch || current.status === 'ready';
    const job = {
      status: 'running',
      revision: randomUUID(),
      cursor: keepPass ? saved.cursor : null,
      attempted: keepBatch ? saved.attempted : 0,
      merged: keepBatch ? saved.merged : 0,
      totalMerged: saved?.totalMerged || 0,
      passFailed: keepPass ? saved.passFailed : 0,
      failures: keepPass ? saved.failures : [],
      deleted: saved?.deleted || 0,
      cleanupPending: saved?.cleanupPending || [],
    };
    let savedValue = JSON.stringify(job);
    if (previous) {
      const claim = await prisma.setting.updateMany({ where: { ...where, value: previous.value }, data: { value: savedValue } });
      if (claim.count !== 1) return publicJob(await getRecord());
    } else {
      try {
        await prisma.setting.create({ data: { ...where, value: savedValue } });
      } catch (error) {
        if (error.code !== 'P2002') throw error;
        return publicJob(await getRecord());
      }
    }
    active = true;
    const initial = publicJob({ value: savedValue, updatedAt: new Date() });

    async function save(next, product, replacement) {
      const value = JSON.stringify(next);
      async function commit(db) {
        const result = await db.setting.updateMany({ where: { ...where, value: savedValue }, data: { value } });
        if (result.count !== 1) throw new Error('The product frame batch lease was lost.');
        if (!product) return;
        const updated = await db.product.updateMany({
          where: { id: product.id, image: product.image, images: product.images },
          data: replacement,
        });
        if (updated.count !== 1) throw new ProductImagesChanged();
      }
      if (product) await prisma.$transaction(commit);
      else await commit(prisma);
      savedValue = value;
    }

    async function run() {
      let state = job;
      let heartbeat;
      try {
        heartbeat = setInterval(() => {
          prisma.setting.updateMany({ where: { ...where, value: savedValue }, data: { updatedAt: new Date() } })
            .catch(error => console.error('Product frame batch heartbeat:', error));
        }, 15_000);
        const frame = await getFrame(frameFile);
        let hasMore = false;
        let after = state.cursor?.id;
        let inclusive = Boolean(after);

        scan: while (true) {
          const products = await prisma.product.findMany({
            where: after ? { id: { [inclusive ? 'gte' : 'gt']: after } } : {},
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            select: SELECT_PRODUCT,
          });
          if (!products.length) break;
          for (const product of products) {
            const slots = [product.image, ...parseProductImages(product.images)];
            const firstSlot = state.cursor?.id === product.id ? state.cursor.slot : 0;
            for (let slot = firstSlot; slot < slots.length; slot++) {
              const source = slots[slot];
              if (!source) continue;
              const existingFrame = framedPath(source, uploadsDir);
              if (existingFrame && await fs.stat(existingFrame).then(info => info.isFile() && info.size > 500, () => false)) continue;
              if (state.attempted >= BATCH_SIZE) {
                hasMore = true;
                break scan;
              }
              const progress = { ...state, cursor: { id: product.id, slot: slot + 1 }, attempted: state.attempted + 1 };
              try {
                if (existingFrame) throw new FrameSourceError('الملف المدمج مفقود أو تالف على السيرفر.');
                const { url, original } = await prepareImage(source, frame, uploadsDir);
                const replacement = slot === 0
                  ? { image: url, imageWidth: FRAME_WIDTH, imageHeight: FRAME_HEIGHT }
                  : { images: JSON.stringify(slots.slice(1).map((entry, index) => index === slot - 1 ? url : entry)) };
                await retainUnchangedImageCache(product, { ...product, ...replacement }, slot, uploadsDir);
                const success = {
                  ...progress,
                  merged: state.merged + 1,
                  totalMerged: state.totalMerged + 1,
                  cleanupPending: original ? [...state.cleanupPending, { ...original, url }] : state.cleanupPending,
                };
                await save(success, product, replacement);
                state = success;
                Object.assign(product, replacement);
                slots[slot] = url;
              } catch (error) {
                if (!(error instanceof FrameSourceError || error instanceof ProductImagesChanged)) throw error;
                const failure = {
                  productId: product.id,
                  title: product.title,
                  slot,
                  message: error.message || 'تغيّرت صور المنتج أثناء المعالجة. أعد المحاولة.',
                };
                const failed = { ...progress, passFailed: state.passFailed + 1, failures: [...state.failures, failure].slice(-BATCH_SIZE) };
                await save(failed);
                state = failed;
                if (error instanceof ProductImagesChanged) break;
              }
              await delay(25);
            }
          }
          after = products.at(-1).id;
          inclusive = false;
          if (products.length < BATCH_SIZE) break;
        }

        await save(state);
        const deleted = await removeReplacedUploads(prisma, state.cleanupPending, uploadsDir);
        await save({
          ...state,
          status: hasMore ? 'ready' : state.passFailed ? 'retry' : 'complete',
          deleted: state.deleted + deleted,
          cleanupPending: [],
        });
      } catch (error) {
        console.error('Product frame batch error:', error);
        await save({ ...state, status: 'interrupted', error: 'توقفت الدفعة. اضغط لاستكمالها من آخر صورة محفوظة.' })
          .catch(saveError => console.error('Could not save product frame progress:', saveError));
      } finally {
        clearInterval(heartbeat);
        if (state.totalMerged !== job.totalMerged) invalidateCatalogCache();
        active = false;
      }
    }

    setImmediate(run);
    return initial;
  }

  return { status: async () => publicJob(await getRecord()), start };
}

module.exports = { FRAME_JOB_KEY, FrameSourceError, createProductFrameService, frameUploadedProductImage };
