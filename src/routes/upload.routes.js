const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../config/db');
const { adminAuthenticate } = require('../middlewares/auth');
const { upload, isAllowedImageBuffer } = require('../middlewares/upload');
const { resolveImageAlt, optimizeImage, slugifyFileName, toImageUrl, allowedImageTypes } = require('../utils/helpers');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

router.post('/upload', adminAuthenticate, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    if (!isAllowedImageBuffer(req.file)) return res.status(400).json({ error: 'Invalid image content' });
    const altText = resolveImageAlt(req.body, req.file);
    const uploadType = req.query.type || req.body.type;
    const optimized = await optimizeImage(req.file, uploadType);
    const uniqueSuffix = crypto.randomBytes(6).toString('hex');
    const fileName = `${slugifyFileName(altText)}-${uniqueSuffix}.${optimized.extension}`;
    
    const uploadPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(uploadPath, optimized.data);
    
    const imageUrl = `/uploads/${fileName}`;

    res.json({
      id: uniqueSuffix,
      url: imageUrl,
      thumbnailUrl: imageUrl,
      altText,
      width: optimized.width,
      height: optimized.height,
      size: optimized.size
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/upload-multiple', adminAuthenticate, upload.array('images', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  try {
    const urls = [];
    for (const file of req.files) {
      if (!isAllowedImageBuffer(file)) return res.status(400).json({ error: 'Invalid image content' });
      const altText = resolveImageAlt(req.body, file);
      const optimized = await optimizeImage(file);
      const uniqueSuffix = crypto.randomBytes(6).toString('hex');
      const fileName = `${slugifyFileName(altText)}-${uniqueSuffix}.${optimized.extension}`;
      
      const uploadPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(uploadPath, optimized.data);
      
      urls.push(`/uploads/${fileName}`);
    }
    res.json({ urls });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/images/:id/meta', async (req, res) => {
  try {
    const image = await prisma.imageStore.findUnique({
      where: { id: req.params.id },
      select: { id: true, mimeType: true, fileName: true, altText: true, width: true, height: true, size: true, createdAt: true }
    });
    if (!image) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.json({ ...image, url: toImageUrl(image.id), thumbnailUrl: toImageUrl(image.id, 'thumb') });
  } catch(e) {
    console.error('Error fetching image metadata:', e);
    res.status(500).json({ error: 'Error' });
  }
});

const PLACEHOLDER_SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f1f5f9"/><rect x="140" y="130" width="120" height="100" rx="8" fill="#cbd5e1"/><circle cx="170" cy="155" r="12" fill="#94a3b8"/><polygon points="140,230 185,175 215,205 240,185 260,230" fill="#94a3b8"/><text x="200" y="270" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#94a3b8">صورة غير متاحة</text></svg>`);

router.get('/images/:id/thumb', async (req, res) => {
  try {
    const image = await prisma.imageStore.findUnique({
      where: { id: req.params.id },
      select: { mimeType: true, data: true, thumbnailData: true }
    });
    if (!image) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.send(PLACEHOLDER_SVG);
    }
    let mimeType = image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType;
    if (!allowedImageTypes.has(mimeType)) {
      const hex = Buffer.from(image.thumbnailData || image.data).toString('hex', 0, 8);
      for (const [mime, prefixes] of allowedImageTypes.entries()) {
        if (prefixes.some(p => hex.startsWith(p))) {
          mimeType = mime;
          break;
        }
      }
    }
    
    if (!allowedImageTypes.has(mimeType)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(PLACEHOLDER_SVG);
    }
    const buf = image.thumbnailData || image.data;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  } catch(e) {
    console.error(`[ImageThumb] Error id=${req.params.id}:`, e);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(PLACEHOLDER_SVG);
  }
});

router.get('/images/:id', async (req, res) => {
  try {
    const image = await prisma.imageStore.findUnique({
      where: { id: req.params.id },
      select: { mimeType: true, data: true, fileName: true }
    });
    if (!image) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.send(PLACEHOLDER_SVG);
    }
    let mimeType = image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType;
    if (!allowedImageTypes.has(mimeType)) {
      const hex = Buffer.from(image.data).toString('hex', 0, 8);
      for (const [mime, prefixes] of allowedImageTypes.entries()) {
        if (prefixes.some(p => hex.startsWith(p))) {
          mimeType = mime;
          break;
        }
      }
    }
    
    if (!allowedImageTypes.has(mimeType)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(PLACEHOLDER_SVG);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mimeType);
    if (image.fileName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const buf = image.data;
    res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  } catch(e) {
    console.error(`[Image] Error id=${req.params.id}:`, e);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(PLACEHOLDER_SVG);
  }
});

module.exports = router;
