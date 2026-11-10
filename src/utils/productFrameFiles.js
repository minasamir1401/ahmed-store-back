const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const FRAME_URL_PATTERN = /^\/uploads\/product-frames\/v[23]-[a-f0-9]{64}\.jpg$/;

function localUploadName(source) {
  if (typeof source !== 'string' || !source.trim()) return null;
  const value = source.trim();
  try {
    const site = 'https://the-vitahub.com';
    const url = new URL(value, site);
    if (!/^https?:$/.test(url.protocol)) return null;
    const ownHosts = [site, 'https://www.the-vitahub.com', 'https://api.the-vitahub.com',
      process.env.SITE_URL, process.env.PUBLIC_API_URL, process.env.BACKEND_URL]
      .filter(Boolean).map(value => new URL(value, site).hostname);
    if (!ownHosts.includes(url.hostname)) return null;
    const encoded = url.pathname.match(/^\/uploads\/([^/]+)$/)?.[1]
      || (!/^(?:\/|https?:)/i.test(value) && url.pathname.match(/^\/([^/]+)$/)?.[1]);
    const name = encoded && decodeURIComponent(encoded);
    return name && Buffer.byteLength(name) <= 255 && /^[^/\\:*?"<>|\x00-\x1f]+\.(?:jpe?g|png|webp|avif|gif|tiff?|heic)$/i.test(name) ? name : null;
  } catch {
    return null;
  }
}

function framedPath(url, uploadsDir = UPLOADS_DIR) {
  return typeof url === 'string' && FRAME_URL_PATTERN.test(url)
    ? path.join(uploadsDir, 'product-frames', path.posix.basename(url))
    : null;
}

function aliasPath(uploadsDir, name) {
  return path.join(uploadsDir, '.product-frame-aliases', createHash('sha256').update(name).digest('hex'));
}

async function readFrameAlias(uploadsDir, name) {
  try {
    const target = await fs.readFile(aliasPath(uploadsDir, name), 'utf8');
    return framedPath(target, uploadsDir) ? target : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(file, contents) {
  const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function retiredUploadHandler(uploadsDir = UPLOADS_DIR) {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const name = localUploadName(`/uploads${req.path}`);
    if (!name) return next();
    try {
      const target = await readFrameAlias(uploadsDir, name);
      if (!target) return next();
      return res.sendFile(framedPath(target, uploadsDir), { maxAge: '7d' });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { UPLOADS_DIR, localUploadName, framedPath, aliasPath, readFrameAlias, writeAtomic, retiredUploadHandler };
