const multer = require('multer');
const path = require('path');
const { allowedImageTypes } = require('../utils/helpers');

const storage = multer.memoryStorage();

const isAllowedImageBuffer = (file) => {
  if (!file || !file.buffer) return false;
  
  // Try to match by signature first (most reliable)
  const signature = file.buffer.subarray(0, 16).toString('hex').toLowerCase();
  
  // Check if it's AVIF (contains ftypavif at offset 4, which is index 8 in hex string)
  if (signature.substring(8, 24) === '6674797061766966' || signature.substring(8, 24) === '6674797061766973') {
    return true;
  }
  
  for (const prefixes of allowedImageTypes.values()) {
    if (prefixes.some(prefix => signature.startsWith(prefix))) {
      return true;
    }
  }
  
  const mime = file.mimetype ? file.mimetype.toLowerCase() : '';
  if (allowedImageTypes.has(mime)) return true;
  return false;
};

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype ? file.mimetype.toLowerCase() : '';
    const ext = file.originalname ? path.extname(file.originalname).toLowerCase() : '';
    const isAllowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.jfif', '.avif'].includes(ext);
    if (allowedImageTypes.has(mime) || isAllowedExt) {
      return cb(null, true);
    }
    console.warn(`[Upload Rejected] MIME: "${file.mimetype}", Ext: "${ext}", Name: "${file.originalname}"`);
    return cb(new Error(`Invalid file type: ${file.mimetype || 'unknown'}`));
  }
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB limit for backups
  fileFilter: (req, file, cb) => {
    const ext = file.originalname ? path.extname(file.originalname).toLowerCase() : '';
    const mime = file.mimetype ? file.mimetype.toLowerCase() : '';
    if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || mime === 'application/octet-stream' || ext === '.zip') {
      return cb(null, true);
    }
    console.warn(`[Backup Upload Rejected] MIME: "${file.mimetype}", Ext: "${ext}", Name: "${file.originalname}"`);
    return cb(new Error(`Invalid file type for backup: ${file.mimetype || 'unknown'}. Only ZIP files are allowed.`));
  }
});

module.exports = {
  upload,
  backupUpload,
  isAllowedImageBuffer
};
