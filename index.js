const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const compression = require('compression');
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { initWhatsApp, logoutWhatsApp, sendWhatsAppMessage, getStatus } = require('./src/services/whatsappService');
const { notifyGoogleIndexing } = require('./src/services/googleIndexingService');
const { sendOrderConfirmationEmail } = require('./src/services/emailService');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured');
}
if (JWT_SECRET.length < 32) {
  console.warn('⚠️ WARNING: JWT_SECRET should be at least 32 characters for production security.');
}

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

const app = express();
app.use(compression());
app.set('trust proxy', 1);
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;
const SITE_URL = (process.env.SITE_URL || 'https://the-vitahub.com').replace(/\/+$/, '');

// Slug helpers for product URLs
function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u0600-\u06FF-]/g, '') // Keep alphanumeric, spaces, Arabic letters, and dashes
    .replace(/[\s_]+/g, '-')              // Replace spaces/underscores with dashes
    .replace(/-+/g, '-')                  // Collapse multiple dashes
    .replace(/^-+|-+$/g, '');             // Trim leading/trailing dashes
}

function getProductUrlParam(product) {
  const source = product.titleEn || product.title || '';
  const slug = slugify(source);
  return slug ? `${slug}-${product.id}` : product.id;
}

const publicUserSelect = { id: true, email: true, name: true, phone: true, role: true };
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

const signToken = (user, expiresIn = process.env.JWT_EXPIRES_IN || '2h') => jwt.sign(
  { id: user.id, email: user.email, role: user.role },
  JWT_SECRET,
  { expiresIn, algorithm: 'HS256' }
);

const verifyGoogleIdToken = async (credential) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    const error = new Error('Google sign-in is not configured');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
  if (!response.ok) {
    const error = new Error('Invalid Google credential');
    error.status = 401;
    throw error;
  }

  const payload = await response.json();
  if (payload.aud !== googleClientId || payload.email_verified !== 'true' || !payload.email) {
    const error = new Error('Invalid Google account');
    error.status = 401;
    throw error;
  }

  return {
    email: normalizeString(payload.email, 254).toLowerCase(),
    name: normalizeString(payload.name || payload.email, 120)
  };
};

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const normalizeString = (value, maxLength = 1000) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const slugifyFileName = (value, fallback = 'product-image') => {
  const ascii = normalizeString(value, 120)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u060C\u061B\u061F\u066A-\u066D]/g, '-')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || fallback;
};

const resolveImageAlt = (body = {}, file = {}) => {
  return normalizeString(body.altText || body.imageAlt || body.title || file.originalname || 'Product image', 180);
};

const toImageUrl = (id, variant = 'full') => variant === 'thumb' ? `/api/images/${id}/thumb` : `/api/images/${id}`;

const parseDbImageUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/api\/images\/([^/?#]+)(?:\/thumb)?/);
  return match ? match[1] : null;
};

const isDbImageUrl = (url) => Boolean(parseDbImageUrl(url));

const optimizeImage = async (file, type) => {
  const extension = path.extname(file.originalname).replace('.', '') || 'jpg';
  
  let detectedMime = file.mimetype;
  const hex = file.buffer.toString('hex', 0, 8);
  for (const [mime, prefixes] of allowedImageTypes.entries()) {
    if (prefixes.some(p => hex.startsWith(p))) {
      detectedMime = mime;
      break;
    }
  }

  let finalBuffer = file.buffer;
  let finalWidth = null;
  let finalHeight = null;

  if (type === 'side-banner') {
    try {
      console.log('Resizing uploaded side-banner image to 800x400 using sharp...');
      finalBuffer = await sharp(file.buffer)
        .resize(800, 400, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
      finalWidth = 800;
      finalHeight = 400;
    } catch (sharpError) {
      console.error('Failed to resize image with sharp:', sharpError);
    }
  } else if (type === 'slider') {
    try {
      console.log('Resizing uploaded slider image to 1200x600 using sharp...');
      finalBuffer = await sharp(file.buffer)
        .resize(1200, 600, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
      finalWidth = 1200;
      finalHeight = 600;
    } catch (sharpError) {
      console.error('Failed to resize slider image with sharp:', sharpError);
    }
  }

  return {
    data: finalBuffer,
    thumbnailData: null, // Let it fallback to full image for speed
    mimeType: detectedMime,
    width: finalWidth,
    height: finalHeight,
    size: finalBuffer.length,
    extension: extension.toLowerCase()
  };
};

const parsePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const toPositiveNumber = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${fieldName} must be a positive number`);
    error.status = 400;
    throw error;
  }
  return parsed;
};

const pick = (source, allowedKeys) => {
  const result = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
};

// ── Auth Middlewares ──────────────────────────────────────────
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: publicUserSelect });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: publicUserSelect });
    if (user) req.user = user;
  } catch (err) {}
  next();
});

const adminAuthenticate = asyncHandler(async (req, res, next) => {
  await authenticate(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'صلاحيات غير كافية - للمسؤولين فقط' });
    }
    next();
  });
});

// Test connection
prisma.$connect()
  .then(async () => {
    console.log('Successfully connected to database');
    try {
      const adminExists = await prisma.user.findFirst({ where: { role: 'admin' } });
      if (!adminExists) {
        console.log('No admin user found. Creating default admin...');
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123456', 12);
        await prisma.user.create({
          data: {
            email: 'admin@mithaly.com',
            password: hashedPassword,
            name: 'المدير العام',
            phone: '201000000000',
            role: 'admin'
          }
        });
        console.log('Default admin user created successfully ✅');
      }

      // Seed default settings if they do not exist (forced updates via upsert)
      const defaultSettings = [
        { key: 'smtp_host', value: 'smtp.gmail.com' },
        { key: 'smtp_port', value: '587' },
        { key: 'smtp_secure', value: 'false' },
        { key: 'smtp_user', value: 'the.vitaminshub@gmail.com' },
        { key: 'smtp_pass', value: 'xrnd iepd yhlo bjst' },
        { key: 'from_email', value: 'the.vitaminshub@gmail.com' },
        { key: 'from_name', value: 'The VitaHub' },
        { key: 'whatsapp_number', value: '01201450111' },
        { key: 'receiving_number', value: '01009596452' }
      ];

      for (const setting of defaultSettings) {
        await prisma.setting.upsert({
          where: { key: setting.key },
          update: { value: setting.value },
          create: { key: setting.key, value: setting.value }
        });
      }
    } catch (err) {
      console.error('Error seeding default admin/settings:', err);
    }
  })
  .catch((err) => console.error('Failed to connect to database:', err));

// ── CORS ───────────────────────────────────────────────────────
const defaultOrigins = process.env.NODE_ENV === 'production'
  ? ['https://the-vitahub.com', 'https://api.the-vitahub.com']
  : ['https://the-vitahub.com', 'http://the-vitahub.com', 'https://api.the-vitahub.com', 'http://localhost:3000', 'http://localhost:5000'];

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    const origins = allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins;
    if (!origin || origins.includes(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'", "https://api.the-vitahub.com", "http://localhost:5000"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، يرجى المحاولة لاحقاً' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، يرجى المحاولة لاحقاً' }
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ limit: process.env.FORM_BODY_LIMIT || '1mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow');
  }
}));


// ── Multer Configuration ──────────────────────────────────────
const storage = multer.memoryStorage();
const allowedImageTypes = new Map([
  ['image/jpeg', ['ffd8ff']],
  ['image/jpg', ['ffd8ff']],
  ['image/pjpeg', ['ffd8ff']],
  ['image/png', ['89504e47']],
  ['image/x-png', ['89504e47']],
  ['image/webp', ['52494646']],
  ['image/avif', ['6674797061766966']]
]);

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

const excelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
      cb(null, `import-${Date.now()}-${file.originalname}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname ? path.extname(file.originalname).toLowerCase() : '';
    const mime = file.mimetype ? file.mimetype.toLowerCase() : '';
    if (ext === '.xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime === 'application/octet-stream') {
      return cb(null, true);
    }
    return cb(new Error('Only Excel (.xlsx) files are allowed.'));
  }
});

app.use('/api', require('./src/routes/upload.routes'));

// ── AI Endpoints ──────────────────────────────────────────────
function generateMockFAQs(productTitle) {
  const title = productTitle || 'المنتج';
  const titleLower = title.toLowerCase();
  
  let faqs = [];

  if (titleLower.includes('magnesium') || titleLower.includes('مغنيسيوم')) {
    faqs = [
      {
        question_ar: `ما هي الفوائد الأساسية لمكمل ${title}؟`,
        question_en: `What are the primary benefits of ${title}?`,
        answer_ar: "سترات المغنيسيوم تدعم صحة العضلات والأعصاب، وتساعد في إنتاج الطاقة الخلوية، وتقليل التشنجات والشد العضلي، بالإضافة إلى تحسين جودة النوم ومكافحة الأرق والقلق.",
        answer_en: "Magnesium Citrate supports muscle and nerve health, assists in cellular energy production, reduces muscle cramps and spasms, and improves sleep quality while fighting insomnia and anxiety."
      },
      {
        question_ar: "ما هي الجرعة وطريقة الاستخدام المثالية؟",
        question_en: "What is the recommended dosage and best time to use?",
        answer_ar: "يوصى بتناول قرص واحد (200 ملجم) يومياً مع الوجبة وكوب كامل من الماء، ويفضل تناوله مساءً للمساعدة على استرخاء العضلات وتحسين النوم.",
        answer_en: "It is recommended to take one tablet (200 mg) daily with a meal and a full glass of water, preferably in the evening to help relax muscles and promote better sleep."
      },
      {
        question_ar: "هل هذا المنتج أصلي وكيف يتم تخزينه؟",
        question_en: "Is this product authentic and how should it be stored?",
        answer_ar: "نعم، المنتج أصلي 100% ومستورد من Now Foods الأمريكية. يحفظ في مكان بارد وجاف بعد الفتح، بعيداً عن متناول الأطفال.",
        answer_en: "Yes, this product is 100% authentic and imported from Now Foods USA. Store in a cool, dry place after opening, out of reach of children."
      }
    ];
  } else if (titleLower.includes('omega') || titleLower.includes('أوميجا') || titleLower.includes('سمك') || titleLower.includes('fish oil')) {
    faqs = [
      {
        question_ar: `ما هي فوائد تناول ${title}؟`,
        question_en: `What are the key benefits of taking ${title}?`,
        answer_ar: "أوميجا 3 تدعم صحة القلب والأوعية الدموية، تساعد في خفض الكوليسترول والدهون الثلاثية الضارة، وتحسن التركيز والوظائف الإدراكية والذاكرة، كما تدعم صحة المفاصل وتقلل الالتهابات.",
        answer_en: "Omega-3 supports cardiovascular and heart health, helps lower bad cholesterol and triglycerides, improves focus and cognitive memory functions, and supports joint health by reducing inflammation."
      },
      {
        question_ar: "متى يفضل تناوله وهل يترك طعماً شبيهاً بالسمك؟",
        question_en: "When should I take it and does it leave a fishy aftertaste?",
        answer_ar: "يفضل تناول كبسولة واحدة يومياً مع وجبة رئيسية تحتوي على دهون (مثل الغداء). الكبسولات مغلفة بتقنية تمنع التحلل في المعدة، مما يمنع التجشؤ برائحة السمك تماماً.",
        answer_en: "It is best to take one capsule daily with a fat-containing meal (like lunch). The capsules are enterically coated, which prevents them from dissolving in the stomach, completely avoiding any fishy aftertaste or burps."
      },
      {
        question_ar: "هل هو أصلي ومناسب للجميع؟",
        question_en: "Is it authentic and safe for everyone?",
        answer_ar: "نعم، المنتج أصلي 100% ومستخلص من زيت سمك نقي وخالي من المعادن الثقيلة كالزئبق. يجب استشارة الطبيب في حالات الحمل أو الرضاعة أو تناول مسيلات الدم.",
        answer_en: "Yes, it is 100% authentic and extracted from pure fish oil, molecularly distilled to be free from heavy metals like mercury. Consult a doctor if pregnant, nursing, or taking blood thinners."
      }
    ];
  } else if (titleLower.includes('vitamin d') || titleLower.includes('فيتامين د') || titleLower.includes('d3') || titleLower.includes('د٣')) {
    faqs = [
      {
        question_ar: `لماذا أحتاج مكمل ${title}؟`,
        question_en: `Why do I need ${title} supplement?`,
        answer_ar: "فيتامين د3 ضروري لامتصاص الكالسيوم والفوسفور بشكل سليم، مما يقوي العظام والأسنان، ويعزز جهاز المناعة، ويحسن النشاط البدني والمزاج العام.",
        answer_en: "Vitamin D3 is essential for the proper absorption of calcium and phosphorus, which strengthens bones and teeth, boosts the immune system, and improves physical energy and mood."
      },
      {
        question_ar: "ما هي الجرعة الصحيحة وكيف يتم تناولها لامتصاص أقصى؟",
        question_en: "What is the correct dosage and how to maximize its absorption?",
        answer_ar: "تناول كبسولة واحدة يومياً، ويفضل تناولها بعد وجبة دسمة تحتوي على دهون صحية (مثل زيت الزيتون أو المكسرات) لأن فيتامين د3 يذوب في الدهون لامتصاصه الأمثل.",
        answer_en: "Take one capsule daily, preferably after a meal containing healthy fats (such as olive oil or nuts) because Vitamin D3 is fat-soluble and requires fats for optimal absorption."
      },
      {
        question_ar: "هل المنتج مستورد وأصلي؟",
        question_en: "Is the product imported and authentic?",
        answer_ar: "نعم، المنتج مستورد وأصلي 100% ومصنع وفقاً لأعلى معايير الجودة العالمية وممارسات التصنيع الجيد (GMP).",
        answer_en: "Yes, the product is 100% imported and authentic, manufactured in accordance with strict international quality standards and Good Manufacturing Practices (GMP)."
      }
    ];
  } else {
    faqs = [
      {
        question_ar: `ما هي الميزات والفوائد الرئيسية لمنتج ${title}؟`,
        question_en: `What are the key features and benefits of ${title}?`,
        answer_ar: "يتميز هذا المنتج بتركيبته النقية وفعاليته العالية التي تدعم الصحة العامة والحيوية اليومية، ومصنوع من مكونات عالية الجودة لتقديم الدعم الأمثل للجسم.",
        answer_en: "This product is distinguished by its pure formula and high efficacy, supporting general health and daily vitality. It is crafted from high-quality ingredients to deliver optimal body support."
      },
      {
        question_ar: "ما هي طريقة الاستخدام والجرعة اليومية الموصى بها؟",
        question_en: "What is the recommended daily dosage and usage instructions?",
        answer_ar: "يوصى بتناول حصة واحدة يومياً مع كوب كبير من الماء، ويفضل الالتزام بموعد ثابت يومياً لضمان تحقيق أفضل النتائج والاستفادة القصوى.",
        answer_en: "It is recommended to take one serving daily with a large glass of water, preferably at a consistent time each day to ensure the best results and maximum benefit."
      },
      {
        question_ar: "هل هذا المنتج أصلي وهل يحتوي على مسببات للحساسية؟",
        question_en: "Is this product authentic and does it contain allergens?",
        answer_ar: "نعم، المنتج أصلي 100% ومضمون الجودة. تركيبته خالية من الجلوتين، الصويا، الألبان، والمكونات المعدلة وراثياً لضمان سلامته وملائمته لمختلف الأنظمة الغذائية.",
        answer_en: "Yes, this product is 100% authentic with guaranteed quality. The formula is free from gluten, soy, dairy, and GMOs to ensure safety and suitability for various dietary needs."
      }
    ];
  }

  return JSON.stringify(faqs);
}

// ── OpenRouter Model Rotation ───────────────────────────
// Rotating list of models (prioritizing user's requested free models, then paid fallbacks).
const OR_FREE_MODELS = [
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.1-8b-instruct'
];
let orModelIndex = 0; // Shared rotation index across all callers

// Robust JSON parser for AI outputs
function parseAIJSON(str) {
  if (typeof str !== 'string') return {};
  let cleaned = str.trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  cleaned = cleaned.replace(/\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

  let insideQuote = false;
  let result = '';
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const isEscaped = i > 0 && cleaned[i - 1] === '\\' && (i < 2 || cleaned[i - 2] !== '\\');

    if (char === '"' && !isEscaped) {
      insideQuote = !insideQuote;
      result += char;
    } else if (insideQuote) {
      if (char === '\n') result += '\\n';
      else if (char === '\r') result += '\\r';
      else if (char === '\t') result += '\\t';
      else result += char;
    } else {
      result += char;
    }
  }

  return JSON.parse(result);
}

// Reusable SEO generator with OpenRouter or APIFreeLLM
// Reusable AI query function with fallback, key rotation, and request timeout
// Centralized fetch function for APIFreeLLM with automatic retry and rate-limit handling
async function fetchAPIFreeLLMWithRetry(prompt, keysToTry) {
  let lastError = null;
  const rateLimitTimes = [];

  for (const key of keysToTry) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
    try {
      console.log(`[APIFreeLLM] Requesting APIFreeLLM with key: ${key.slice(0, 10)}...`);
      const response = await fetch('https://apifreellm.com/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          message: prompt,
          model: 'apifreellm'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch (e) {}

      const isRateLimit = response.status === 429 || 
                          (data && (data.code === 429 || (data.error && typeof data.error === 'string' && data.error.toLowerCase().includes('rate limit'))));

      const isServerError = [502, 503, 504].includes(response.status);

      if (isRateLimit) {
        let retryAfter = 18;
        if (data && typeof data.retryAfter === 'number') {
          retryAfter = data.retryAfter;
        } else if (data && data.error && typeof data.error === 'string') {
          const match = data.error.match(/wait (\d+) second/i);
          if (match) retryAfter = parseInt(match[1], 10);
        }
        console.warn(`[APIFreeLLM] Key ${key.slice(0, 10)}... rate limited. retryAfter: ${retryAfter}s`);
        rateLimitTimes.push({ key, retryAfter });
        lastError = new Error(data?.error || `Rate limit exceeded. Please wait ${retryAfter} seconds.`);
        continue; // Try the next key
      }

      if (isServerError) {
        console.warn(`[APIFreeLLM] Key ${key.slice(0, 10)}... returned server error ${response.status}. Retrying next key...`);
        lastError = new Error(`APIFreeLLM server error ${response.status}: ${responseText}`);
        rateLimitTimes.push({ key, retryAfter: 3 });
        continue;
      }

      if (!response.ok) {
        throw new Error(`APIFreeLLM status ${response.status}: ${responseText}`);
      }

      if (data && data.success && data.response) {
        return data.response;
      } else {
        const errMsg = data ? (data.message || data.error || JSON.stringify(data)) : 'success=false';
        throw new Error(errMsg);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[APIFreeLLM] Key ${key.slice(0, 10)}... failed:`, err.message);
      lastError = err;
    }
  }

  // If all keys failed, and any of them were due to rate limit or server error, let's wait and retry!
  if (rateLimitTimes.length > 0) {
    rateLimitTimes.sort((a, b) => a.retryAfter - b.retryAfter);
    const bestChoice = rateLimitTimes[0];
    
    console.warn(`[APIFreeLLM] All keys failed/rate-limited. Best key to retry is ${bestChoice.key.slice(0, 10)}... in ${bestChoice.retryAfter}s. Waiting...`);
    await new Promise(resolve => setTimeout(resolve, (bestChoice.retryAfter + 1.5) * 1000));
    
    const key = bestChoice.key;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      console.log(`[APIFreeLLM] Retrying APIFreeLLM with key: ${key.slice(0, 10)}...`);
      const response = await fetch('https://apifreellm.com/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          message: prompt,
          model: 'apifreellm'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch (e) {}

      if (!response.ok) {
        throw new Error(`APIFreeLLM status ${response.status}: ${responseText}`);
      }

      if (data && data.success && data.response) {
        return data.response;
      } else {
        const errMsg = data ? (data.message || data.error || JSON.stringify(data)) : 'success=false';
        throw new Error(errMsg);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(`[APIFreeLLM] Retry failed:`, err.message);
      throw err;
    }
  }

  throw lastError || new Error('APIFreeLLM query failed');
}

async function queryAI(prompt, maxTokens = 2000, provider = 'openrouter') {
  if (provider === 'apifree') {
    const keysToTry = [];
    const envKey = process.env.APIFREE_API_KEY || '';
    if (envKey) keysToTry.push(envKey);
    keysToTry.push('apf_xsuukak3i8667v8bcj4sx4wf'); // Working fallback key
    return await fetchAPIFreeLLMWithRetry(prompt, keysToTry);
  } else {
    // OpenRouter
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not defined');

    let lastError = null;
    const maxAttempts = OR_FREE_MODELS.length * 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const modelName = OR_FREE_MODELS[orModelIndex];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
      try {
        console.log(`[queryAI] Requesting OpenRouter model: ${modelName} (Attempt ${attempt}/${maxAttempts})...`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://the-vitahub.com',
            'X-Title': 'The VitaHub Auto SEO'
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          await response.text();
          console.warn(`[queryAI] Model "${modelName}" 429. Switching...`);
          orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[queryAI] Model "${modelName}" status ${response.status}: ${errText}. Switching...`);
          orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          return content;
        } else {
          throw new Error('Empty choices returned from OpenRouter');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn(`[queryAI] OpenRouter attempt ${attempt} failed:`, err.message);
        lastError = err;
        orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw lastError || new Error('OpenRouter query failed');
  }
}

// Reusable SEO generator with OpenRouter or APIFreeLLM
async function generateAndSaveProductSEO(productId, force = false, provider = 'openrouter') {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { brand: true, category: true }
    });

    if (!product) {
      console.log(`[SEO Background Worker] Product ${productId} not found.`);
      return { success: false, error: 'Product not found' };
    }

    // Only update if it doesn't already have detailed descriptions
    const hasDetailedDesc = product.desc && product.desc.length > 200;
    if (hasDetailedDesc && !force) {
      console.log(`[SEO Background Worker] Product ${product.title} already has detailed description. Skipping.`);
      return { success: true, skipped: true };
    }

    const brandName = product.brand?.name || 'The VitaHub';
    const categoryName = product.category?.name || 'فيتامينات ومكملات';

    console.log(`[SEO Background Worker] Generating SEO content for: "${product.title}" (${brandName}) using ${provider}...`);

    // Call 1: Product Descriptions, Usage, Ingredients, Warnings, FAQs
    const prompt1 = `أنت خبير محتوى محترف وعالم صيدلة سريرية متخصص في المكملات والمنتجات الصحية في مصر.
مهمتك هي كتابة محتوى متكامل، غني وعالي الجودة، ومتوافق تماماً مع محركات البحث (SEO) باللغة العربية لمنتج مكمل غذائي.
- اسم المنتج: ${product.title}
- الماركة: ${brandName}
- القسم: ${categoryName}

يجب عليك إرجاع كائن JSON فقط بدون أي نصوص خارجية وبدقة علمية تامة بالهيكل التالي:
{
  "desc": "وصف تفصيلي كامل ومقنع باللغة العربية يتجاوز 350 كلمة، يشرح الفوائد والمكونات ودواعي الاستخدام وكيف يساعد العميل بالتفصيل، ولماذا الشراء من The VitaHub هو الأفضل.",
  "descEn": "Detailed professional description in English exceeding 350 words.",
  "usage": "طريقة الاستخدام والجرعات الموصى بها بالتفصيل باللغة العربية.",
  "usageEn": "Detailed usage and dosage instructions in English.",
  "ingredients": "المكونات بالتفصيل باللغة العربية.",
  "ingredientsEn": "Detailed ingredients list in English.",
  "warnings": "المحاذير الطبية وموانع الاستعمال باللغة العربية.",
  "warningsEn": "Medical warnings and precautions in English.",
  "faqs": [
    {
      "question_ar": "سؤال شائع 1 بالعربية؟",
      "answer_ar": "إجابة احترافية 1 بالعربية.",
      "question_en": "Question 1 in English?",
      "answer_en": "Professional answer 1 in English."
    },
    {
      "question_ar": "سؤال شائع 2 بالعربية؟",
      "answer_ar": "إجابة احترافية 2 بالعربية.",
      "question_en": "Question 2 in English?",
      "answer_en": "Professional answer 2 in English."
    },
    {
      "question_ar": "سؤال شائع 3 بالعربية؟",
      "answer_ar": "إجابة احترافية 3 بالعربية.",
      "question_en": "Question 3 in English?",
      "answer_en": "Professional answer 3 in English."
    },
    {
      "question_ar": "سؤال شائع 4 بالعربية؟",
      "answer_ar": "إجابة احترافية 4 بالعربية.",
      "question_en": "Question 4 in English?",
      "answer_en": "Professional answer 4 in English."
    },
    {
      "question_ar": "سؤال شائع 5 بالعربية؟",
      "answer_ar": "إجابة احترافية 5 بالعربية.",
      "question_en": "Question 5 in English?",
      "answer_en": "Professional answer 5 in English."
    }
  ]
}`;

    console.log(`[SEO Background Worker] Generating Part 1 (Content)...`);
    const content1 = await queryAI(prompt1, 2500, provider);
    const dataPart1 = parseAIJSON(content1);

    // Wait 2 seconds to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Call 2: Keywords and Meta descriptions matching user's custom SEO prompt
    const prompt2 = `أنت خبير SEO متخصص في المتاجر الإلكترونية التي تبيع الفيتامينات والمكملات الغذائية. أريد منك إنشاء قائمة شاملة من الكلمات المفتاحية (SEO Keywords) لمنتج مكمل غذائي.

التعليمات:
* أنشئ من 200 إلى 500 كلمة مفتاحية.
* اكتب الكلمات المفتاحية بالعربية والإنجليزية معًا بداخل حقل "seoKeywords" بفاصلة عربية "،".
* أضف جميع أشكال اسم المنتج والعلامة التجارية.
* أضف الكلمات المفتاحية المتعلقة بالفوائد المحتملة للمنتج بطريقة متوافقة مع سياسات Google.
* أضف الكلمات المفتاحية المتعلقة بالاستخدامات العامة والصحة والعافية.
* أضف كلمات البحث التجارية مثل: شراء، سعر، أفضل، أصلي، مستورد.
* أضف الكلمات المفتاحية الخاصة بالمكونات النشطة.
* أضف الكلمات المفتاحية الخاصة بالفئة (فيتامينات، مكملات، أعشاب، بروبيوتيك، معادن، إلخ).
* أضف الكلمات المفتاحية الخاصة بالجمهور المستهدف (رجال، نساء، أطفال، رياضيين، كبار السن).
* أضف الكلمات المفتاحية الخاصة بالجودة مثل: Non GMO، Gluten Free، Vegan، Organic، Made in USA.
* أضف الكلمات المفتاحية الخاصة بالدعم الصحي بصيغة "دعم" فقط، وتجنب الادعاءات الطبية أو العلاجية.
* لا تكرر الكلمات المفتاحية نفسها.
* افصل جميع الكلمات المفتاحية بفاصلة عربية "،".
* اجعل الناتج جاهزًا للنسخ واللصق في SEO.

بيانات المنتج لدمجها:
- اسم المنتج: ${product.title}
- العلامة التجارية: ${brandName}
- الفئة: ${categoryName}

يجب عليك إرجاع كائن JSON فقط بالهيكل التالي بدقة ودون أي كلام خارجي على الإطلاق:
{
  "seoKeywords": "قائمة من 200 إلى 500 كلمة مفتاحية SEO بالعربية والإنجليزية معًا مفصولة بفاصلة عربية '،'.",
  "seoKeywordsEn": "قائمة من 200 إلى 500 كلمة مفتاحية SEO بالعربية والإنجليزية معًا مفصولة بفاصلة عربية '،'.",
  "seoDesc": "وصف ميتا للبحث بالعربية مقنع وجذاب ويشجع على الشراء (بين 150 و 220 حرفاً) مع ذكر اسم المتجر The VitaHub بشكل طبيعي.",
  "seoDescEn": "Meta description in English for Google search (150-220 characters) naturally mentioning the store name The VitaHub."
}`;

    console.log(`[SEO Background Worker] Generating Part 2 (Keywords & Meta)...`);
    const content2 = await queryAI(prompt2, 2000, provider);
    const dataPart2 = parseAIJSON(content2);

    await prisma.product.update({
      where: { id: productId },
      data: {
        desc: dataPart1.desc || product.desc,
        descEn: dataPart1.descEn || product.descEn,
        usage: dataPart1.usage || product.usage,
        usageEn: dataPart1.usageEn || product.usageEn,
        ingredients: dataPart1.ingredients || product.ingredients,
        ingredientsEn: dataPart1.ingredientsEn || product.ingredientsEn,
        warnings: dataPart1.warnings || product.warnings,
        warningsEn: dataPart1.warningsEn || product.warningsEn,
        seoKeywords: dataPart2.seoKeywords || product.seoKeywords,
        seoKeywordsEn: dataPart2.seoKeywordsEn || product.seoKeywordsEn,
        seoDesc: dataPart2.seoDesc || product.seoDesc,
        seoDescEn: dataPart2.seoDescEn || product.seoDescEn,
        faqs: typeof dataPart1.faqs === 'object' ? JSON.stringify(dataPart1.faqs) : dataPart1.faqs || product.faqs
      }
    });

    console.log(`[SEO Background Worker] Successfully updated product ${productId} SEO content.`);
    return { success: true };

  } catch (error) {
    console.error(`[SEO Background Worker] Error updating product ${productId}:`, error.message);
    throw error;
  }
}

const seoQueue = [];
let seoQueueProcessing = false;

function addToSeoQueue(productId) {
  // Automatic SEO update is disabled by user request
  return;
}

function triggerSeoQueueProcessing() {
  if (seoQueueProcessing) return;
  seoQueueProcessing = true;
  
  (async () => {
    while (seoQueue.length > 0) {
      const productId = seoQueue.shift();
      try {
        console.log(`[SEO Queue] Processing product ${productId} (${seoQueue.length} remaining)...`);
        await generateAndSaveProductSEO(productId);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        console.error(`[SEO Queue] Failed to process product ${productId}:`, err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    seoQueueProcessing = false;
    console.log(`[SEO Queue] Finished processing all products in queue.`);
  })();
}


app.post('/api/admin/products/:id/generate-seo', adminAuthenticate, async (req, res) => {
  try {
    const provider = req.body.provider || 'openrouter';
    const result = await generateAndSaveProductSEO(req.params.id, true, provider);
    res.json(result);
  } catch (error) {
    console.error('Manual SEO Generation Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate SEO' });
  }
});

app.get('/api/admin/indexing/logs', adminAuthenticate, async (req, res) => {
  try {
    const logs = await prisma.indexingLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/indexing/submit', adminAuthenticate, async (req, res) => {
  const { url, type } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const result = await notifyGoogleIndexing(url, type || 'URL_UPDATED');
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/generate', adminAuthenticate, adminLimiter, async (req, res) => {
  const systemMessage = req.body.messages?.find(m => m.role === 'system')?.content || '';
  const isFAQRequest = systemMessage.includes('الأسئلة الشائعة') || systemMessage.includes('FAQs');

  const fallbackHandler = () => {
    console.log('[AI Fallback] Using mock generator for FAQs.');
    const userMessage = req.body.messages?.find(m => m.role === 'user')?.content || '';
    let productTitle = '';
    const titleMatch = userMessage.match(/اسم المنتج:\n([^\n]+)/);
    if (titleMatch) {
      productTitle = titleMatch[1].trim();
    } else {
      productTitle = userMessage.split('\n')[0].replace('اسم المنتج:', '').trim();
    }
    
    // Parse title if it is bilingual JSON format
    if (productTitle.startsWith('{') && productTitle.endsWith('}')) {
      try {
        const parsedTitle = JSON.parse(productTitle);
        productTitle = parsedTitle.ar || parsedTitle.en || productTitle;
      } catch (e) {}
    }

    const mockContent = generateMockFAQs(productTitle);
    return res.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: mockContent
          }
        }
      ]
    });
  };

  // Support Puter AI directly with live Web Search grounding
  const puterKey = process.env.PUTER_API_KEY || '';
  const requestedModel = req.body.model || '';

  if (req.body.provider === 'puter' || (requestedModel.includes('puter') || (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && puterKey))) {
    try {
      if (!puterKey) throw new Error('Puter API key is missing');
      const messages = req.body.messages || [];
      const formattedMessages = messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || ''
      }));

      const response = await fetch('https://api.puter.com/puterai/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${puterKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: formattedMessages,
          tools: [{ type: 'web_search' }] // Enable Puter web search grounding
        })
      });

      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      } else {
        const errText = await response.text();
        console.warn('Puter API returned error status:', response.status, errText);
      }
    } catch (err) {
      console.warn('[Puter direct call failed, falling back]', err);
    }
  }

  // Support Google Gemini API directly with live Google Search grounding - DISABLED by user request
  /*
  const geminiKey = process.env.GEMINI_API_KEY || '';
  
  if (geminiKey && (req.body.provider === 'gemini' || requestedModel.includes('gemini') || !process.env.OPENROUTER_API_KEY)) {
    try {
      const messages = req.body.messages || [];
      const userMsg = messages.find(m => m.role === 'user')?.content || '';
      const sysMsg = messages.find(m => m.role === 'system')?.content || '';

      const geminiPayload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: userMsg }]
          }
        ],
        tools: [
          {
            google_search: {} // Enables Google Search Grounding for real-time web search!
          }
        ]
      };

      if (sysMsg) {
        geminiPayload.systemInstruction = {
          parts: [{ text: sysMsg }]
        };
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(geminiPayload)
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: text
              }
            }
          ]
        });
      } else {
        console.warn('Gemini API direct call returned error status:', response.status);
      }
    } catch (err) {
      console.warn('[Gemini direct call failed, trying OpenRouter fallback]', err);
    }
  }
  */

  // Support APIFreeLLM directly
  if (req.body.provider === 'apifree' || requestedModel === 'apifree') {
    try {
      const messages = req.body.messages || [];
      const sysMsg = messages.find(m => m.role === 'system')?.content || '';
      const userMsg = messages.find(m => m.role === 'user')?.content || '';
      let prompt = '';
      if (sysMsg) {
        prompt += `${sysMsg}\n\n`;
      }
      prompt += userMsg;

      const keysToTry = [];
      const envKey = process.env.APIFREE_API_KEY || '';
      if (envKey) keysToTry.push(envKey);
      keysToTry.push('apf_xsuukak3i8667v8bcj4sx4wf'); // Working fallback key

      const responseText = await fetchAPIFreeLLMWithRetry(prompt, keysToTry);
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: responseText
            }
          }
        ]
      });
    } catch (err) {
      console.error('[APIFreeLLM call failed]', err);
      if (isFAQRequest) {
        return fallbackHandler();
      }
      return res.status(502).json({ 
        error: { 
          message: "فشل الاتصال بـ APIFreeLLM: " + err.message,
          details: err.message
        } 
      });
    }
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) return res.status(503).json({ error: 'AI service is not configured' });
    const payload = { ...req.body };
    delete payload.apiKey;
    delete payload.provider;

    // Rotate through free models on rate-limit
    const modelName = payload.model || OR_FREE_MODELS[orModelIndex];
    payload.model = modelName;
    delete payload.models;

    let lastError = null;
    let responseData = null;
    let success = false;
    let lastStatus = 503;
    const maxAttempts = OR_FREE_MODELS.length + 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentModel = OR_FREE_MODELS[orModelIndex];
      // If user explicitly sent a model, honor it on first attempt only
      payload.model = (attempt === 1 && modelName !== OR_FREE_MODELS[0]) ? modelName : currentModel;
      try {
        console.log(`[OpenRouter] Requesting model: ${payload.model} (Attempt ${attempt}/${maxAttempts})`);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        lastStatus = response.status;

        if (response.status === 429) {
          await response.text();
          console.warn(`[OpenRouter] Model "${payload.model}" rate-limited. Switching...`);
          orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const textError = await response.text();
          console.warn(`[OpenRouter] Non-JSON from "${payload.model}". Switching...`);
          orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        const data = await response.json();
        if (!response.ok) {
          console.warn(`[OpenRouter] Error ${response.status} from "${payload.model}". Switching...`);
          orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        responseData = data;
        success = true;
        break;
      } catch (err) {
        console.warn(`[OpenRouter] Attempt ${attempt} failed:`, err.message);
        lastError = err;
        orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (!success) {
      console.error('[OpenRouter] All attempts failed. Last error:', lastError);
      if (isFAQRequest) {
        return fallbackHandler();
      }
      return res.status(lastStatus).json({ 
        error: { 
          message: "فشلت محاولات الاتصال بالذكاء الاصطناعي على النموذج المحدد. يرجى المحاولة لاحقاً.",
          details: lastError ? lastError.message : undefined
        } 
      });
    }

    res.json(responseData);
  } catch (error) {
    console.error('AI Proxy Error:', error);
    if (isFAQRequest) {
      return fallbackHandler();
    }
    res.status(503).json({ error: { message: "تعذر الاتصال بخدمة الذكاء الاصطناعي. يرجى المحاولة لاحقاً." } });
  }
});

app.post('/api/ai/bmi-advice', authLimiter, async (req, res) => {
  const { bmi, statusText, height, weight, age, gender, language } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const puterKey = process.env.PUTER_API_KEY || '';
  if (!apiKey && !puterKey) return res.status(503).json({ error: 'AI service is not configured' });

  const numericBmi = Number(bmi);
  if (!Number.isFinite(numericBmi) || numericBmi <= 0 || numericBmi > 100) {
    return res.status(400).json({ error: 'Invalid BMI value' });
  }

  const isArabic = language !== 'en';
  const systemInstruction = isArabic
    ? 'أنت خبير تغذية ورياضة مصري صريح وموجز جداً. قدم نصيحة احترافية ومختصرة بناءً على مؤشر كتلة الجسم. ممنوع الكلام الكتير أو الجداول. ردك لازم يكون في 5 أسطر فقط كحد أقصى، يشمل: تقييم سريع للحالة، حل للمشكلة إن وجدت، واقتراح لمكمل غذائي واحد مفيد.'
    : 'You are an honest, concise nutritionist. Provide professional, short advice based on the BMI score. No tables, no long explanations. Your response must be in exactly 5 lines max, including: quick status assessment, solution to the problem if any, and suggest one useful supplement.';

  const userMessage = isArabic
    ? `بياناتي: طول ${normalizeString(height, 10)}، وزن ${normalizeString(weight, 10)}، عمر ${normalizeString(age, 10)}، جنس ${gender === 'male' ? 'ذكر' : 'أنثى'}. مؤشر BMI هو ${numericBmi} وحالتي هي ${normalizeString(statusText, 80)}. قولي المختصر المفيد في 5 سطور بالظبط.`
    : `My data: Height ${normalizeString(height, 10)}cm, Weight ${normalizeString(weight, 10)}kg, Age ${normalizeString(age, 10)}, Gender ${gender === 'male' ? 'male' : 'female'}. My BMI is ${numericBmi} and my status is ${normalizeString(statusText, 80)}. Give me the exact summary in 5 lines.`;

  if (puterKey && !apiKey) {
    try {
      const response = await fetch('https://api.puter.com/puterai/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${puterKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userMessage }
          ],
          tools: [{ type: 'web_search' }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return res.json({ advice: text });
      }
    } catch (err) {
      console.error('Puter BMI error:', err);
    }
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OR_FREE_MODELS[orModelIndex],
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userMessage }
        ]
      })
    });

    const data = await response.json();
    if (response.status === 429) {
      orModelIndex = (orModelIndex + 1) % OR_FREE_MODELS.length;
      return res.status(429).json({ error: 'Rate limited, please retry shortly.' });
    }
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'AI request failed' });
    return res.json({ advice: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    console.error('BMI AI error:', error);
    return res.status(502).json({ error: 'AI service failed' });
  }
});

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const splitTranslationText = (text, maxLength = 1200) => {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    let cutIndex = remaining.lastIndexOf('\n', maxLength);
    if (cutIndex < maxLength * 0.5) cutIndex = remaining.lastIndexOf('،', maxLength);
    if (cutIndex < maxLength * 0.5) cutIndex = remaining.lastIndexOf(',', maxLength);
    if (cutIndex < maxLength * 0.5) cutIndex = remaining.lastIndexOf(' ', maxLength);
    if (cutIndex < maxLength * 0.5) cutIndex = maxLength;

    chunks.push(remaining.slice(0, cutIndex).trim());
    remaining = remaining.slice(cutIndex).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

const translateChunk = async (text, from = 'ar', to = 'en') => {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from,
    tl: to,
    dt: 't',
    q: text
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data[0]) {
        return data[0]
          .map(segment => segment[0])
          .filter(Boolean)
          .join('');
      }

      return text;
    }

    if (attempt === 3 || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`Google Translate API error: ${response.status}`);
    }

    await wait(400 * attempt);
  }

  return text;
};

app.post('/api/translate', adminAuthenticate, adminLimiter, async (req, res) => {
  const { text, from = 'ar', to = 'en' } = req.body;
  const cleaned = typeof text === 'string' ? text.trim() : '';
  if (!cleaned) return res.status(400).json({ error: 'Text is required' });

  try {
    const translatedChunks = [];
    const chunks = splitTranslationText(cleaned);

    for (const chunk of chunks) {
      translatedChunks.push(await translateChunk(chunk, from, to));
      if (chunks.length > 1) await wait(150);
    }

    res.json({ translation: translatedChunks.join('\n').trim() });
  } catch (error) {
    console.error('Translation route error:', error);
    res.status(502).json({ error: error.message });
  }
});

// ── Health Check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Mithaly Backend is running smoothly! 🚀' });
});

app.get('/api/auth/google-config', authLimiter, (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.get('/api/auth/test-diagnostic', adminAuthenticate, (req, res) => {
  res.json({
    message: 'Diagnostic OK',
    time: new Date(),
    routes: app._router.stack.filter(r => r.route).map(r => `${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`)
  });
});


// ── Auth Routes ───────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password, name, phone } = req.body;
  
  // 1. Data Normalization & Cleaning
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanPassword = password ? password.trim() : '';
  const cleanName = name ? name.trim() : '';
  const cleanPhone = phone ? phone.trim() : '';

  // 2. Validation Checks
  if (!cleanEmail || !cleanPassword || !cleanName || !cleanPhone) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صالحة' });
  }

  if (cleanPassword.length < 6) {
    return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور عن 6 أحرف' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });

    const hashedPassword = await bcrypt.hash(cleanPassword, 12);
    const user = await prisma.user.create({
      data: { 
        email: cleanEmail, 
        password: hashedPassword, 
        name: cleanName, 
        phone: cleanPhone 
      }
    });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone } });

    // Send welcome message via WhatsApp asynchronously
    const welcomeMessage = `مرحباً بك يا ${user.name} في The VitaHub! 🌟\nتم إنشاء حسابك بنجاح باستخدام هذا الرقم.\nيسعدنا انضمامك إلينا!`;
    sendWhatsAppMessage(user.phone, welcomeMessage);
  } catch (error) {
    res.status(500).json({ error: 'فشل في إنشاء الحساب، يرجى المحاولة لاحقاً' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, phone, password } = req.body;
  
  const cleanPhone = phone ? phone.trim() : '';
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanPassword = typeof password === 'string' ? password.trim() : '';

  if ((!cleanPhone && !cleanEmail) || !cleanPassword) {
    return res.status(400).json({ error: 'رقم الهاتف أو البريد الإلكتروني وكلمة المرور مطلوبان' });
  }

  try {
    let user = null;
    if (cleanPhone) {
      user = await prisma.user.findFirst({ where: { phone: cleanPhone } });
    } else if (cleanEmail) {
      user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    }

    if (!user) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    const valid = await bcrypt.compare(cleanPassword, user.password);
    if (!valid) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone } });
  } catch (error) {
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
  const { credential } = req.body;
  const cleanCredential = typeof credential === 'string' ? credential.trim() : '';

  if (!cleanCredential) {
    return res.status(400).json({ error: 'بيانات حساب جوجل مطلوبة' });
  }

  try {
    const googleUser = await verifyGoogleIdToken(cleanCredential);
    let user = await prisma.user.findUnique({ where: { email: googleUser.email } });

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 12);
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          password: hashedPassword,
          name: googleUser.name
        }
      });
    } else if (!user.name && googleUser.name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: googleUser.name }
      });
    }

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone } });
  } catch (error) {
    const status = error.status || 500;
    const message = status === 503
      ? 'تسجيل الدخول بجوجل غير مفعل حالياً'
      : status === 401
        ? 'تعذر التحقق من حساب جوجل'
        : 'حدث خطأ أثناء تسجيل الدخول بجوجل';
    res.status(status).json({ error: message });
  }
});

// ── Admin Login Route ─────────────────────────────────────────
app.post('/api/auth/admin-login', authLimiter, async (req, res) => {
  const { username, email, phone, password } = req.body;

  // username field can be either email, phone or name
  const rawIdentifier = username || email || phone || '';
  const cleanPassword = typeof password === 'string' ? password.trim() : '';

  if (!rawIdentifier || !cleanPassword) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  const cleanIdentifier = rawIdentifier.trim();

  try {
    const adminUser = await prisma.user.findFirst({
      where: {
        role: 'admin',
        OR: [
          { email: cleanIdentifier.toLowerCase() },
          { phone: cleanIdentifier },
          { name: cleanIdentifier }
        ]
      }
    });

    if (!adminUser) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    const valid = await bcrypt.compare(cleanPassword, adminUser.password);
    if (!valid) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    // Admin sessions last 7 days
    const token = signToken(adminUser, process.env.ADMIN_JWT_EXPIRES_IN || '7d');
    res.json({ token, user: { id: adminUser.id, email: adminUser.email, name: adminUser.name || 'المدير العام', role: 'admin' } });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// ── User Cart Persistence Routes ──────────────────────────────
app.get('/api/cart', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ cart: user.cart ? JSON.parse(user.cart) : [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cart', authenticate, async (req, res) => {
  const { cart } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const safeCart = Array.isArray(cart) ? cart.slice(0, 50).map(item => ({
      id: String(item.id || '').slice(0, 120),
      title: normalizeString(item.title, 500),
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
      quantity: Math.min(Math.max(Number.parseInt(item.quantity, 10) || 1, 1), 20),
      image: normalizeString(item.image, 1000),
      size: item.size ? normalizeString(item.size, 120) : undefined
    })).filter(item => item.id) : [];
    const cartString = JSON.stringify(safeCart);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { cart: cartString }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// ── Admin Profile Endpoints ──────────────────
app.get('/api/admin/profile', adminAuthenticate, async (req, res) => {
  try {
    const adminUser = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (adminUser) {
      return res.json({ email: adminUser.email, name: adminUser.name });
    }
    return res.status(404).json({ error: 'المشرف غير موجود' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/update-profile', adminAuthenticate, async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const adminUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!adminUser) return res.status(404).json({ error: 'المشرف غير موجود' });

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
    const cleanPassword = typeof password === 'string' ? password.trim() : '';
    // Allow any string to be used as username/email for the admin
    // if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صالحة' });
    if (cleanPassword && cleanPassword.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });

    const hashedPassword = cleanPassword ? await bcrypt.hash(cleanPassword, 12) : undefined;

    const updated = await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        email: cleanEmail || undefined,
        password: hashedPassword,
        name: cleanName || undefined
      }
    });
    return res.json({ success: true, user: { id: updated.id, email: updated.email, name: updated.name } });
  } catch (error) {
    console.error('Update admin profile error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث بيانات المشرف' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getSetting(tx, key, defaultValue) {
  try {
    const setting = await tx.setting.findUnique({ where: { key } });
    return setting ? setting.value : defaultValue;
  } catch (err) {
    return defaultValue;
  }
}

async function setSetting(tx, key, value) {
  await tx.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

// ── Settings Endpoints ──────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const whatsapp_number = await getSetting(prisma, 'whatsapp_number', '01201450111');
    const receiving_number = await getSetting(prisma, 'receiving_number', '01009596452');
    res.json({ whatsapp_number, receiving_number });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/settings', adminAuthenticate, async (req, res) => {
  try {
    const keys = [
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user',
      'smtp_pass', 'from_email', 'from_name',
      'whatsapp_number', 'receiving_number'
    ];
    const settings = {};
    for (const key of keys) {
      let def = '';
      if (key === 'smtp_host') def = 'smtp.gmail.com';
      if (key === 'smtp_port') def = '587';
      if (key === 'smtp_secure') def = 'false';
      if (key === 'from_name') def = 'The VitaHub';
      if (key === 'whatsapp_number') def = '01201450111';
      if (key === 'receiving_number') def = '01009596452';

      settings[key] = await getSetting(prisma, key, def);
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/settings', adminAuthenticate, async (req, res) => {
  const data = req.body;
  try {
    const keys = [
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user',
      'smtp_pass', 'from_email', 'from_name',
      'whatsapp_number', 'receiving_number'
    ];
    for (const key of keys) {
      if (data[key] !== undefined) {
        await setSetting(prisma, key, String(data[key]));
      }
    }
    res.json({ message: 'تم حفظ الإعدادات بنجاح' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/settings/test-email', adminAuthenticate, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'البريد الإلكتروني للمستلم مطلوب' });
  try {
    const keys = [
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user',
      'smtp_pass', 'from_email', 'from_name'
    ];
    const settings = {};
    for (const key of keys) {
      let def = '';
      if (key === 'smtp_host') def = 'smtp.gmail.com';
      if (key === 'smtp_port') def = '587';
      if (key === 'smtp_secure') def = 'false';
      if (key === 'from_name') def = 'The VitaHub';
      settings[key] = await getSetting(prisma, key, def);
    }
    const { sendTestEmail } = require('./src/services/emailService');
    await sendTestEmail(settings, to);
    res.json({ message: 'تم إرسال بريد إلكتروني تجريبي بنجاح' });
  } catch (error) {
    console.error('SMTP test email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── WhatsApp and Forgot Password Endpoints ──────────────────
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = phone ? phone.trim() : '';

  if (!cleanPhone) {
    return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { phone: cleanPhone }
    });

    const genericResponse = { success: true, message: 'إذا كان الرقم مسجلاً سيتم إرسال رمز التحقق عبر واتساب' };
    if (!user) return res.json(genericResponse);

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(`${otpCode}:${JWT_SECRET}`).digest('hex');
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtpCode: otpHash,
        resetOtpExpires: otpExpires
      }
    });

    const messageText = `رمز التحقق الخاص بك لإعادة تعيين كلمة المرور هو: *${otpCode}*\nصلاحية الرمز 10 دقائق. يرجى عدم مشاركته مع أي شخص.`;
    const sent = await sendWhatsAppMessage(cleanPhone, messageText);

    if (sent) {
      res.json(genericResponse);
    } else {
      res.status(500).json({ error: 'فشل في إرسال رسالة واتساب، يرجى المحاولة لاحقاً أو التأكد من ربط واتساب' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء إرسال الرمز' });
  }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const { phone, code, newPassword } = req.body;
  const cleanPhone = phone ? phone.trim() : '';
  const cleanCode = code ? code.trim() : '';
  const cleanPassword = newPassword ? newPassword.trim() : '';

  if (!cleanPhone || !cleanCode || !cleanPassword) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  if (cleanPassword.length < 6) {
    return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور عن 6 أحرف' });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { phone: cleanPhone }
    });

    if (!user) return res.status(400).json({ error: 'بيانات التحقق غير صحيحة' });

    const submittedHash = crypto.createHash('sha256').update(`${cleanCode}:${JWT_SECRET}`).digest('hex');
    if (!user.resetOtpCode || user.resetOtpCode !== submittedHash) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح' });
    }

    if (!user.resetOtpExpires || new Date() > user.resetOtpExpires) {
      return res.status(400).json({ error: 'رمز التحقق انتهت صلاحيته' });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetOtpCode: null,
        resetOtpExpires: null
      }
    });

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إعادة تعيين كلمة المرور' });
  }
});

app.get('/api/whatsapp/status', adminAuthenticate, (req, res) => {
  res.json(getStatus());
});

app.post('/api/whatsapp/logout', adminAuthenticate, async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'تم تسجيل الخروج من واتساب بنجاح ويجري إعادة التهيئة' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Products Routes ───────────────────────────────────────────
// ── Brands Endpoints ──────────────────────────────────────────
app.get('/api/brands', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    const brands = await prisma.brand.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/brands', adminAuthenticate, async (req, res) => {
  const { name, nameEn, image } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Brand name required' });
  try {
    // Use upsert to avoid duplicate name errors
    const brand = await prisma.brand.upsert({
      where: { name: name.trim() },
      update: { image: image || undefined, nameEn: nameEn || undefined },
      create: { name: name.trim(), nameEn: nameEn || null, image: image || null }
    });
    res.status(201).json(brand);
  } catch (error) {
    console.error('POST /api/brands error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/auto-find-brand-logo', adminAuthenticate, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الماركة مطلوب' });

  try {
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) return res.status(503).json({ error: 'OpenRouter API key is not configured' });

    const prompt = `Search the web or use your knowledge to find the official website domain of the dietary supplement, health, or vitamin brand named "${name}". Only return the domain name (e.g., brand.com or company.co.uk). Do not include "www", protocols (http/https), slashes, markdown, or any other text. If not found, return "notfound".

Answer with ONLY the domain name, nothing else. Do not write introductory text, do not write markdown, do not write explanations. Example output: brand.com`;

    const modelsToTry = [
      "google/gemini-2.5-flash:free",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-3.1-8b-instruct:free",
      "meta-llama/llama-3.1-8b-instruct"
    ];

    let domain = '';
    let success = false;
    let lastError = null;

    const extractDomain = (text) => {
      if (!text) return '';
      let cleaned = text.trim().toLowerCase();
      const domainRegex = /([a-z0-9-]+\.[a-z]{2,10}(?:\.[a-z]{2,10})?)/g;
      const matches = cleaned.match(domainRegex);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          if (match !== 'notfound' && !match.includes('openrouter') && !match.includes('llama') && !match.includes('gemini') && match.length >= 4) {
            return match;
          }
        }
      }
      cleaned = cleaned.replace(/[^a-z0-9.\-]/g, '');
      if (cleaned && cleaned !== 'notfound' && cleaned.length >= 4 && cleaned.includes('.')) {
        return cleaned;
      }
      return '';
    };

    for (const model of modelsToTry) {
      try {
        console.log(`[OpenRouter] Trying model ${model} for logo search...`);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || '';
          const cleaned = extractDomain(text);
          if (cleaned) {
            domain = cleaned;
            success = true;
            break;
          }
        } else {
          const errText = await response.text();
          throw new Error(`Status ${response.status}: ${errText}`);
        }
      } catch (err) {
        console.warn(`[OpenRouter] Model ${model} failed:`, err.message);
        lastError = err;
      }
    }

    if (!success || !domain) {
      return res.status(404).json({ error: 'لم يتم العثور على موقع رسمي للماركة' });
    }

    // Try Hunter logo first (since it is our primary high-resolution, non-blocked service)
    const logoUrl = `https://logos.hunter.io/${domain}`;
    const fallbackUrl = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`;

    let finalLogo = logoUrl;
    try {
      const checkRes = await fetch(logoUrl, { method: 'HEAD', timeout: 5000 });
      if (!checkRes.ok) {
        finalLogo = fallbackUrl;
      }
    } catch (e) {
      console.warn('Failed to verify Hunter logo, using fallback favicon:', e.message);
      finalLogo = fallbackUrl;
    }

    res.json({ domain, logoUrl: finalLogo });
  } catch (error) {
    console.error('Error auto-finding brand logo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/auto-find-all-brand-logos', adminAuthenticate, async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) return res.status(503).json({ error: 'OpenRouter API key is not configured' });

    // Fetch all brands
    const brands = await prisma.brand.findMany();
    let updatedCount = 0;

    const modelsToTry = [
      "google/gemini-2.5-flash:free",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-3.1-8b-instruct:free"
    ];

    const extractDomain = (text) => {
      if (!text) return '';
      let cleaned = text.trim().toLowerCase();
      const domainRegex = /([a-z0-9-]+\.[a-z]{2,10}(?:\.[a-z]{2,10})?)/g;
      const matches = cleaned.match(domainRegex);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          if (match !== 'notfound' && !match.includes('openrouter') && !match.includes('llama') && !match.includes('gemini') && match.length >= 4) {
            return match;
          }
        }
      }
      cleaned = cleaned.replace(/[^a-z0-9.\-]/g, '');
      if (cleaned && cleaned !== 'notfound' && cleaned.length >= 4 && cleaned.includes('.')) {
        return cleaned;
      }
      return '';
    };

    for (const brand of brands) {
      // Only find logo if they don't have a valid logo or are using a placeholder
      const hasPlaceholder = !brand.image || brand.image.includes('placehold.co') || brand.image === '';
      if (hasPlaceholder) {
        try {
          const prompt = `Search the web or use your knowledge to find the official website domain of the dietary supplement, health, or vitamin brand named "${brand.name}". Only return the domain name (e.g., brand.com or company.co.uk). Do not include "www", protocols (http/https), slashes, markdown, or any other text. If not found, return "notfound".

Answer with ONLY the domain name, nothing else. Do not write introductory text, do not write markdown, do not write explanations. Example output: brand.com`;

          let domain = '';
          let success = false;

          for (const model of modelsToTry) {
            try {
              const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: model,
                  messages: [{ role: "user", content: prompt }]
                })
              });

              if (response.ok) {
                const data = await response.json();
                const text = data.choices?.[0]?.message?.content || '';
                const cleaned = extractDomain(text);
                if (cleaned) {
                  domain = cleaned;
                  success = true;
                  break;
                }
              }
            } catch (err) {
              console.warn(`[OpenRouter Bulk] Model ${model} failed for ${brand.name}:`, err.message);
            }
          }

          if (success && domain) {
            const logoUrl = `https://logos.hunter.io/${domain}`;
            const fallbackUrl = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`;
            let finalLogo = logoUrl;
            try {
              const checkRes = await fetch(logoUrl, { method: 'HEAD', timeout: 3000 });
              if (!checkRes.ok) finalLogo = fallbackUrl;
            } catch (e) {
              finalLogo = fallbackUrl;
            }

            await prisma.brand.update({
              where: { id: brand.id },
              data: { image: finalLogo }
            });
            updatedCount++;
          }
        } catch (err) {
          console.warn(`Failed to auto-find logo for brand ${brand.name}:`, err.message);
        }
      }
    }

    res.json({ message: `Successfully updated ${updatedCount} brand logos.`, updatedCount });
  } catch (error) {
    console.error('Error auto-finding all brand logos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/brands/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 24, 100);
    const skip = (page - 1) * limit;
    const brand = await prisma.brand.findUnique({
      where: { id: req.params.id },
      include: {
        products: {
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, titleEn: true, price: true, oldPrice: true,
            image: true, tag: true, categoryId: true, brandId: true, createdAt: true
          }
        },
        _count: { select: { products: true } }
      }
    });
    if (!brand) return res.status(404).json({ error: 'Not found' });
    res.json({ ...brand, totalProducts: brand._count.products, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/brands/:id', adminAuthenticate, async (req, res) => {
  const { name, nameEn, image } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Brand name cannot be empty' });
  try {
    const brand = await prisma.brand.update({
      where: { id: req.params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        nameEn: nameEn !== undefined ? (nameEn || null) : undefined,
        image: image !== undefined ? (image || null) : undefined
      }
    });
    res.json(brand);
  } catch (error) {
    console.error('PATCH /api/brands/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/brands/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.brand.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Products Endpoints ────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 24, 100);
    const isLegacyList = !req.query.page && !req.query.limit;
    const take = isLegacyList ? 1000 : limit;
    const skip = isLegacyList ? 0 : (page - 1) * take;
    const q = normalizeString(req.query.q, 120);
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
    const priceFilter = {};
    if (Number.isFinite(minPrice)) priceFilter.gte = minPrice;
    if (Number.isFinite(maxPrice)) priceFilter.lte = maxPrice;

    const where = {
      ...(req.query.categoryId ? { categoryId: { in: String(req.query.categoryId).split(',') } } : {}),
      ...(req.query.brandId ? { brandId: { in: String(req.query.brandId).split(',') } } : {}),
      ...(Object.keys(priceFilter).length > 0 ? { price: priceFilter } : {}),
      ...(q ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { titleEn: { contains: q, mode: 'insensitive' } },
          { seoKeywords: { contains: q, mode: 'insensitive' } },
          { seoKeywordsEn: { contains: q, mode: 'insensitive' } }
        ]
      } : {})
    };

    let orderBy = { createdAt: 'desc' };
    if (req.query.sortBy === 'price-asc') orderBy = { price: 'asc' };
    if (req.query.sortBy === 'price-desc') orderBy = { price: 'desc' };

    const include = {
      category: { select: { id: true, name: true, image: true } },
      brand: { select: { id: true, name: true, image: true } }
    };

    const maxPriceAggregate = await prisma.product.aggregate({
      _max: { price: true }
    });
    const maxProductPrice = maxPriceAggregate._max.price || 5000;

    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({ where, skip, take, include, orderBy }),
      prisma.product.count({ where })
    ]);

    if (isLegacyList) return res.json(products);
    res.json({ items: products, total, page, limit: take, maxPrice: maxProductPrice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true, brand: true }
    });
    if (!product) return res.status(404).json({ error: 'Not found' });
    const imageId = parseDbImageUrl(product.image);
    if (!imageId) return res.json(product);
    const imageMeta = await prisma.imageStore.findUnique({
      where: { id: imageId },
      select: { altText: true, width: true, height: true }
    });
    res.json({
      ...product,
      imageAlt: product.imageAlt || imageMeta?.altText || product.title,
      imageWidth: product.imageWidth || imageMeta?.width,
      imageHeight: product.imageHeight || imageMeta?.height
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', adminAuthenticate, async (req, res) => {
  const { 
    title, titleEn, desc, descEn, features, featuresEn, price, oldPrice, discountType, discountValue, 
    image, images, imageAlt, imageWidth, imageHeight, sizes, tag, seoKeywords, seoDesc, categoryId, brandId,
    sizeOptions, specifications, keyInfo, certifications, usage, ingredients,
    usageEn, ingredientsEn, supplementFacts, warnings, warningsEn, disclaimer, disclaimerEn,
    seoKeywordsEn, seoDescEn, dosageCalculator, faqs, expiryDate
  } = req.body;
  try {
    const cleanTitle = normalizeString(title, 300);
    const cleanPrice = toPositiveNumber(price, 'price');
    if (!cleanTitle || !categoryId) return res.status(400).json({ error: 'title, categoryId and price are required' });
    const cleanImage = image || 'https://placehold.co/400x400?text=No+Image';
    const cleanImageAlt = normalizeString(imageAlt || cleanTitle, 180);
    const product = await prisma.product.create({
      data: { 
        title: cleanTitle, titleEn, desc, descEn, features, featuresEn, price: cleanPrice, oldPrice, discountType, discountValue, 
        image: cleanImage, images, imageAlt: cleanImageAlt, imageWidth, imageHeight, sizes, tag, seoKeywords, seoDesc, categoryId, brandId,
        sizeOptions, specifications, keyInfo, certifications, usage, usageEn, ingredients, ingredientsEn,
        supplementFacts, warnings, warningsEn, disclaimer, disclaimerEn, seoKeywordsEn, seoDescEn, dosageCalculator, faqs, expiryDate
      }
    });
    // Notify Google Indexing API (both old and new URLs)
    notifyGoogleIndexing(`${SITE_URL}/product/${product.id}`, 'URL_UPDATED');
    const slugParam = getProductUrlParam(product);
    if (slugParam !== product.id) {
      notifyGoogleIndexing(`${SITE_URL}/product/${slugParam}`, 'URL_UPDATED');
    }
    
    // Trigger background SEO queue if description is missing or very short
    if (!desc || desc.trim().length < 100) {
      addToSeoQueue(product.id);
    }

    res.status(201).json(product);
  } catch (error) {
    console.error('POST /api/products error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/import-excel', adminAuthenticate, excelUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file format' });
  }

  const filePath = req.file.path;

  try {
    const { execFile } = require('child_process');
    const pythonScript = path.join(__dirname, 'src', 'utils', 'parse_excel.py');

    // Run the Python script to parse the Excel file
    execFile('python', [pythonScript, filePath], async (error, stdout, stderr) => {
      // Clean up the uploaded file
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('Failed to delete uploaded temp file:', unlinkErr);
      }

      if (error) {
        console.error('Python execution error:', error, stderr);
        return res.status(500).json({ error: `Failed to parse Excel file: ${stderr || error.message}` });
      }

      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          return res.status(400).json({ error: parsed.error });
        }

        // Upsert the default category "فيتامينات ومعادن"
        const category = await prisma.category.upsert({
          where: { name: "فيتامينات ومعادن" },
          update: {},
          create: { name: "فيتامينات ومعادن", nameEn: "Vitamins & Minerals" }
        });

        let importedCount = 0;
        let updatedCount = 0;

        // Process products sequentially
        for (const item of parsed) {
          const brandName = (item.brand || "Other").trim();
          
          // Find or create the brand
          const brand = await prisma.brand.upsert({
            where: { name: brandName },
            update: {},
            create: { name: brandName }
          });

          // Check if product with this title exists
          const existingProduct = await prisma.product.findFirst({
            where: { title: item.title }
          });

          if (existingProduct) {
            await prisma.product.update({
              where: { id: existingProduct.id },
              data: {
                price: item.price !== null ? item.price : existingProduct.price,
                expiryDate: item.expiryDate || existingProduct.expiryDate,
                categoryId: category.id,
                brandId: brand.id
              }
            });
            updatedCount++;
            // Trigger background SEO if the existing product lacks description details
            if (!existingProduct.desc || existingProduct.desc.trim().length < 100) {
              addToSeoQueue(existingProduct.id);
            }
          } else {
            const product = await prisma.product.create({
              data: {
                title: item.title,
                price: item.price !== null ? item.price : 0,
                expiryDate: item.expiryDate,
                image: 'https://placehold.co/400x400?text=No+Image',
                categoryId: category.id,
                brandId: brand.id
              }
            });
            // Optional: Notify Google Indexing API for new products (both old and new URLs)
            notifyGoogleIndexing(`${SITE_URL}/product/${product.id}`, 'URL_UPDATED');
            const slugParam = getProductUrlParam(product);
            if (slugParam !== product.id) {
              notifyGoogleIndexing(`${SITE_URL}/product/${slugParam}`, 'URL_UPDATED');
            }
            importedCount++;
            // Trigger background SEO for the newly created product
            addToSeoQueue(product.id);
          }
        }

        res.json({
          success: true,
          message: `تم استيراد ${importedCount} منتج جديد وتحديث ${updatedCount} منتج بنجاح.`,
          importedCount,
          updatedCount
        });

      } catch (parseErr) {
        console.error('Failed to parse Python script output:', parseErr, stdout);
        res.status(500).json({ error: 'Failed to process Excel data output.' });
      }
    });

  } catch (err) {
    console.error('Import Excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/products/:id', adminAuthenticate, async (req, res) => {
  const { 
    title, titleEn, desc, descEn, features, featuresEn, price, oldPrice, discountType, discountValue, 
    image, images, imageAlt, imageWidth, imageHeight, sizes, tag, seoKeywords, seoDesc, categoryId, brandId,
    sizeOptions, specifications, keyInfo, certifications, usage, ingredients,
    usageEn, ingredientsEn, supplementFacts, warnings, warningsEn, disclaimer, disclaimerEn,
    seoKeywordsEn, seoDescEn, dosageCalculator, faqs, expiryDate
  } = req.body;
  try {
    const cleanPrice = price !== undefined ? toPositiveNumber(price, 'price') : undefined;
    const cleanImageAlt = imageAlt !== undefined ? normalizeString(imageAlt, 180) : undefined;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { 
        title, titleEn, desc, descEn, features, featuresEn, price: cleanPrice, oldPrice, discountType, discountValue, 
        image, images, imageAlt: cleanImageAlt, imageWidth, imageHeight, sizes, tag, seoKeywords, seoDesc, categoryId, brandId,
        sizeOptions, specifications, keyInfo, certifications, usage, usageEn, ingredients, ingredientsEn,
        supplementFacts, warnings, warningsEn, disclaimer, disclaimerEn, seoKeywordsEn, seoDescEn, dosageCalculator, faqs, expiryDate
      }
    });
    // Notify Google Indexing API (both old and new URLs)
    notifyGoogleIndexing(`${SITE_URL}/product/${product.id}`, 'URL_UPDATED');
    const slugParam = getProductUrlParam(product);
    if (slugParam !== product.id) {
      notifyGoogleIndexing(`${SITE_URL}/product/${slugParam}`, 'URL_UPDATED');
    }
    res.json(product);
  } catch (error) {
    console.error('PATCH /api/products error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', adminAuthenticate, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    await prisma.product.delete({ where: { id: req.params.id } });
    // Notify Google Indexing API (both old and new URLs)
    notifyGoogleIndexing(`${SITE_URL}/product/${req.params.id}`, 'URL_DELETED');
    if (product) {
      const slugParam = getProductUrlParam(product);
      if (slugParam !== req.params.id) {
        notifyGoogleIndexing(`${SITE_URL}/product/${slugParam}`, 'URL_DELETED');
      }
    }
    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Categories Routes ─────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    const formatted = categories.map(cat => ({
      ...cat,
      count: cat._count ? cat._count.products : 0
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', adminAuthenticate, async (req, res) => {
  const { name, nameEn, image, href } = req.body;
  try {
    const category = await prisma.category.create({
      data: { name, nameEn, image, href }
    });
    res.status(201).json(category);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/categories/:id', adminAuthenticate, async (req, res) => {
  const { name, nameEn, image, href, count } = req.body;
  try {
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: { name, nameEn, image, href, count }
    });
    res.json(category);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/categories/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Offers Routes ─────────────────────────────────────────────
app.get('/api/offers', async (req, res) => {
  try {
    const offers = await prisma.offer.findMany();
    res.json(offers);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/offers', adminAuthenticate, async (req, res) => {
  const { title, discount, image, productId } = req.body;
  if (!title || !discount || !image) {
    return res.status(400).json({ error: 'العنوان وعلامة الخصم والصورة مطلوبة' });
  }
  try {
    const offer = await prisma.offer.create({
      data: { title, discount, image, productId: productId || null }
    });
    res.status(201).json(offer);
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/offers/:id', adminAuthenticate, async (req, res) => {
  const { title, discount, image, productId } = req.body;
  try {
    const offer = await prisma.offer.update({
      where: { id: req.params.id },
      data: { title, discount, image, productId: productId || null }
    });
    res.json(offer);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/offers/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.offer.delete({ where: { id: req.params.id } });
    res.json({ message: 'Offer deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Blog Routes ───────────────────────────────────────────────
app.get('/api/blog', async (req, res) => {
  try {
    const posts = await prisma.blog.findMany();
    res.json(posts);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/blog/:id', adminAuthenticate, async (req, res) => {
  const { title, excerpt, content, image, category, readTime, date } = req.body;
  try {
    const post = await prisma.blog.update({
      where: { id: req.params.id },
      data: { title, excerpt, content, image, category, readTime, date }
    });
    res.json(post);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/blog/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.blog.delete({ where: { id: req.params.id } });
    res.json({ message: 'Post deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Translation Route ─────────────────────────────────────────
app.post('/api/translate', adminAuthenticate, async (req, res) => {
  const { text, from = 'ar', to = 'en' } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const translateRes = await fetch(url);
    const data = await translateRes.json();
    const translatedText = data[0].map((x) => x[0]).join('');
    res.json({ text: translatedText });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: error.message || 'Translation failed' });
  }
});

// ── Medical Tips Routes ───────────────────────────────────────
app.get('/api/medical-tips', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    const tips = await prisma.medicalTip.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(tips);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/medical-tips/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    const tip = await prisma.medicalTip.findUnique({ where: { id: req.params.id } });
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/medical-tips', adminAuthenticate, async (req, res) => {
  const { title, titleEn, content, contentEn, image } = req.body;
  try {
    const tip = await prisma.medicalTip.create({
      data: { title, titleEn, content, contentEn, image }
    });
    res.json(tip);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/medical-tips/:id', adminAuthenticate, async (req, res) => {
  const { title, titleEn, content, contentEn, image } = req.body;
  try {
    const tip = await prisma.medicalTip.update({
      where: { id: req.params.id },
      data: { title, titleEn, content, contentEn, image }
    });
    res.json(tip);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/medical-tips/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.medicalTip.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tip deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Hero Section Routes ─────────────────────────────────────────
app.get('/api/hero', async (req, res) => {
  try {
    let hero = await prisma.hero.findUnique({ where: { id: 'hero-section' } });
    if (!hero) {
      hero = await prisma.hero.create({ data: { id: 'hero-section' } });
    }
    res.json(hero);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/hero', adminAuthenticate, async (req, res) => {
  try {
    const allowedHeroFields = [
      'title', 'subtitle', 'image', 'buttonText', 'buttonLink', 'side1Title', 'side1Desc', 'side1Image',
      'side1Link', 'side2Title', 'side2Desc', 'side2Image', 'side2Link', 'prod1Id', 'prod1Image',
      'prod1Type', 'prod2Id', 'prod2Image', 'prod2Type', 'prod3Id', 'prod3Image', 'prod3Type',
      'prod4Id', 'prod4Image', 'prod4Type', 'slides'
    ];
    const data = pick(req.body, allowedHeroFields);
    const hero = await prisma.hero.upsert({
      where: { id: 'hero-section' },
      update: data,
      create: { id: 'hero-section', ...data }
    });
    res.json(hero);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Orders Routes ───────────────────────────────────────────────
app.get('/api/orders', adminAuthenticate, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 100, 200);
    const skip = (page - 1) * limit;
    const where = req.query.status ? { status: String(req.query.status) } : {};
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: { items: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);
    if (!req.query.page && !req.query.limit) return res.json(orders);
    return res.json({ items: orders, total, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/track/:orderNumber', async (req, res) => {
  try {
    const orderNumber = req.params.orderNumber.toUpperCase();
    const phone = normalizeString(req.query.phone, 40);
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف مطلوب لتتبع الطلب' });
    const orders = await prisma.order.findMany({
      where: { 
        orderNumber, 
        customerPhone: {
          contains: phone
        }
      },
      include: { items: true },
      take: 1
    });
    const order = orders[0];
    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود. يرجى التأكد من رقم الطلب' });
    }
    res.json({
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      governorate: order.governorate,
      district: order.district,
      paymentMethod: order.paymentMethod,
      shippingFee: order.shippingFee,
      total: order.total,
      status: order.status,
      shippingRef: order.shippingRef,
      createdAt: order.createdAt,
      items: order.items
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', optionalAuthenticate, async (req, res) => {
  const { 
    customerName, customerEmail, customerPhone, governorate, district, 
    address, building, floor, apartment, notes, paymentMethod, items,
    language
  } = req.body;
  const orderLanguage = language === 'en' ? 'en' : 'ar';
  
  try {
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) return res.status(400).json({ error: 'سلة المنتجات غير صالحة' });
    const cleanCustomerName = normalizeString(customerName, 120);
    const cleanCustomerPhone = normalizeString(customerPhone, 80);
    const cleanGovernorate = normalizeString(governorate, 80);
    const cleanDistrict = normalizeString(district, 120);
    const cleanAddress = normalizeString(address, 500);
    if (!cleanCustomerName || !cleanCustomerPhone || !cleanGovernorate || !cleanDistrict || !cleanAddress) {
      return res.status(400).json({ error: 'بيانات الشحن الأساسية مطلوبة' });
    }

    const requestedItems = items.map(item => ({
      id: String(item.id || '').slice(0, 120),
      quantity: Math.min(Math.max(Number.parseInt(item.quantity, 10) || 1, 1), 20),
      size: item.size ? normalizeString(item.size, 120) : ''
    })).filter(item => item.id);
    if (requestedItems.length === 0) return res.status(400).json({ error: 'سلة المنتجات غير صالحة' });

    const dbProducts = await prisma.product.findMany({
      where: { id: { in: requestedItems.map(item => item.id) } },
      select: { id: true, title: true, price: true, image: true, sizeOptions: true }
    });
    const productById = new Map(dbProducts.map(product => [product.id, product]));
    const orderItems = requestedItems.map(item => {
      const product = productById.get(item.id);
      if (!product) {
        const error = new Error('منتج غير صالح في السلة');
        error.status = 400;
        throw error;
      }

      let unitPrice = Number(product.price);
      let title = product.title;
      if (item.size && product.sizeOptions) {
        try {
          const options = JSON.parse(product.sizeOptions);
          const selected = Array.isArray(options) ? options.find(option => String(option.size) === item.size) : null;
          if (selected && Number.isFinite(Number(selected.price))) {
            unitPrice = Number(selected.price);
            title = `${product.title} (${selected.size})`;
          }
        } catch (e) {}
      }

      return { productId: product.id, title, price: unitPrice, quantity: item.quantity, image: product.image };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const codFee = paymentMethod === 'cod' ? 15 : 0;
    const shippingFee = codFee;
    const calculatedTotal = subtotal + shippingFee;
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(1000, 9999)}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerName: cleanCustomerName,
        customerEmail: normalizeString(customerEmail, 160) || null,
        customerPhone: cleanCustomerPhone,
        governorate: cleanGovernorate,
        district: cleanDistrict,
        address: cleanAddress,
        building: normalizeString(building, 50) || null,
        floor: normalizeString(floor, 50) || null,
        apartment: normalizeString(apartment, 50) || null,
        notes: normalizeString(notes, 500) || null,
        paymentMethod: ['cod', 'instapay'].includes(paymentMethod) ? paymentMethod : 'instapay',
        total: calculatedTotal,
        shippingFee,
        userId: req.user?.id || null,
        shippingRef: null,
        items: {
          create: orderItems
        }
      },
      include: { items: true }
    });
    res.status(201).json(order);

    // ── Meta Conversions API (CAPI) Server-Side Purchase Dispatch ──
    try {
      const customerIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';
      const fbp = req.body.fbp || null;
      const fbc = req.body.fbc || null;
      const orderSourceUrl = req.headers.referer || 'https://the-vitahub.com/checkout';

      // Record the Purchase event in PixelEvent table for analytics
      await prisma.pixelEvent.create({
        data: {
          eventName: 'Purchase',
          url: orderSourceUrl ? normalizeString(orderSourceUrl, 2048) : null,
          customerIp: typeof customerIp === 'string' ? normalizeString(customerIp, 100) : null,
          userAgent: typeof userAgent === 'string' ? normalizeString(userAgent, 500) : null,
          metadata: JSON.stringify({
            orderNumber: order.orderNumber,
            total: order.total,
            currency: 'EGP',
            items: order.items,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            customerEmail: order.customerEmail,
            governorate: order.governorate,
            eventId: order.orderNumber,
            fbp,
            fbc
          })
        }
      });

      // Send Purchase event directly to Meta Conversions API (CAPI) using orderNumber as deduplication event_id
      await sendConversionsApiEvent({
        eventName: 'Purchase',
        eventId: order.orderNumber,
        eventSourceUrl: orderSourceUrl,
        customerIp,
        userAgent,
        fbp,
        fbc,
        customData: {
          currency: 'EGP',
          value: Number(order.total) || 0,
          order_id: order.orderNumber,
          contents: (order.items || []).map(item => ({
            id: String(item.productId || item.id || ''),
            quantity: Number(item.quantity) || 1,
            item_price: Number(item.price) || 0
          })),
          content_type: 'product',
          num_items: (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
        },
        userData: {
          name: order.customerName,
          phone: order.customerPhone,
          email: order.customerEmail,
          city: order.governorate
        }
      });
    } catch (capiErr) {
      console.error('Error dispatching server-side CAPI Purchase event:', capiErr);
    }

    // Send order confirmation message via WhatsApp asynchronously
    const itemsListText = orderLanguage === 'en'
      ? (order.items && order.items.length > 0 
          ? order.items.map(item => `• ${item.title} (Qty: ${item.quantity})`).join('\n')
          : '')
      : (order.items && order.items.length > 0 
          ? order.items.map(item => `• ${item.title} (العدد: ${item.quantity})`).join('\n')
          : '');

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://the-vitahub.com';
    
    const paymentMethodText = orderLanguage === 'en'
      ? (order.paymentMethod === 'cod' ? 'Cash on Delivery' : (order.paymentMethod === 'instapay' ? 'InstaPay' : 'Electronic Wallet'))
      : (order.paymentMethod === 'cod' ? 'الدفع عند الاستلام' : (order.paymentMethod === 'instapay' ? 'إنستاباي' : 'المحفظة الإلكترونية'));

    const shippingFeeText = orderLanguage === 'en'
      ? (order.shippingFee === 0 ? 'Free' : `${order.shippingFee} EGP`)
      : (order.shippingFee === 0 ? 'مجاني' : `${order.shippingFee} ج.م`);

    const orderMessage = orderLanguage === 'en'
      ? `Hello ${order.customerName},

Your order has been successfully placed at The VitaHub! 🎉

Order details #${order.orderNumber}:
${itemsListText}

Shipping & Delivery: ${shippingFeeText}
Total Price: ${order.total} EGP
Payment Method: ${paymentMethodText}

Website Link: ${siteUrl}
Thank you for shopping with us! ❤️`
      : `مرحباً ${order.customerName}،

تم استلام طلبك بنجاح في متجر The VitaHub! 🎉

تفاصيل طلبك رقم #${order.orderNumber}:
${itemsListText}

الشحن والتوصيل: ${shippingFeeText}
إجمالي السعر: ${order.total} ج.م
طريقة الدفع: ${paymentMethodText}

رابط الموقع: ${siteUrl}
شكراً لتسوقك معنا! ❤️`;

    sendWhatsAppMessage(order.customerPhone, orderMessage);

    // Send order confirmation email asynchronously if customer email is provided
    if (order.customerEmail) {
      sendOrderConfirmationEmail(prisma, order, orderLanguage);
    }
  } catch (error) {
    console.error('POST /api/orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── User Specific Orders ─────────────────────────────────────────
app.get('/api/my-orders', authenticate, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      skip: (page - 1) * limit,
      take: limit,
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/my-orders/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id }
    });

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check if the order belongs to the logged-in user
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح لك بإلغاء هذا الطلب' });
    }

    // Check if the order status is pending
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'لا يمكن إلغاء الطلب بعد شحنه أو توصيله' });
    }

    // Delete items first (due to foreign key constraints in SQLite)
    await prisma.orderItem.deleteMany({
      where: { orderId: req.params.id }
    });

    // Delete the order
    await prisma.order.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'تم إلغاء الطلب وحذفه بنجاح' });
  } catch (error) {
    console.error('DELETE /api/my-orders error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إلغاء الطلب' });
  }
});

app.patch('/api/orders/:id', adminAuthenticate, async (req, res) => {
  try {
    const data = pick(req.body, ['status', 'shippingRef']);
    if (data.status && !['pending', 'shipped', 'delivered', 'cancelled'].includes(data.status)) {
      return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
    }
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', adminAuthenticate, async (req, res) => {
  try {
    await prisma.orderItem.deleteMany({
      where: { orderId: req.params.id }
    });
    await prisma.order.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:id/ship', adminAuthenticate, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true }
    });
    
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Aramex Integration Logic using credentials from .env
    const trackingNumber = `ARX${Math.floor(100000000 + Math.random() * 900000000)}`;
    
    console.log(`[Aramex] Shipping Order #${order.orderNumber}`);
    console.log(`[Aramex] Using Account: ${process.env.ARAMEX_ACCOUNT_NUMBER || 'N/A'}`);
    
    const updatedOrder = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        status: 'shipped',
        shippingRef: trackingNumber
      }
    });
    
    res.json({ 
      message: 'تم إرسال الطلب لشركة الشحن بنجاح', 
      trackingNumber, 
      order: updatedOrder 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Backup & Restore Endpoints ────────────────────────────────
const AdmZip = require('adm-zip');

app.get('/api/admin/backup', adminAuthenticate, async (req, res) => {
  try {
    const zip = new AdmZip();

    // Check which tables are available and fetch their data
    const tables = [
      'user',
      'category',
      'brand',
      'product',
      'offer',
      'blog',
      'hero',
      'order',
      'orderItem',
      'imageStore',
      'medicalTip',
      'setting',
      'indexingLog'
    ];

    const dbData = {};
    for (const table of tables) {
      try {
        dbData[table] = await prisma[table].findMany();
      } catch (err) {
        console.warn(`Table "${table}" is not available. Skipping backup for this table. Error:`, err.message);
        dbData[table] = [];
      }
    }

    // Save imageStore binary files separately to prevent JSON size issues
    if (dbData.imageStore && dbData.imageStore.length > 0) {
      for (const row of dbData.imageStore) {
        if (row.data) {
          const dataBuffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data.data || row.data);
          zip.addFile(`imageStore/${row.id}_data.bin`, dataBuffer);
          delete row.data;
        }
        if (row.thumbnailData) {
          const thumbBuffer = Buffer.isBuffer(row.thumbnailData) ? row.thumbnailData : Buffer.from(row.thumbnailData.data || row.thumbnailData);
          zip.addFile(`imageStore/${row.id}_thumb.bin`, thumbBuffer);
          delete row.thumbnailData;
        }
      }
    }

    // Add database.json to zip
    zip.addFile('database.json', Buffer.from(JSON.stringify(dbData, null, 2), 'utf8'));

    // Add uploads directory to zip
    const uploadsDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          zip.addLocalFile(filePath, 'uploads');
        }
      }
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=mithaly-backup.zip');
    res.send(zipBuffer);
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup: ' + error.message });
  }
});

app.post('/api/admin/restore', adminAuthenticate, backupUpload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
  try {
    const zip = new AdmZip(req.file.buffer);
    const databaseEntry = zip.getEntry('database.json');
    if (!databaseEntry) {
      return res.status(400).json({ error: 'Invalid backup file: database.json is missing' });
    }

    const dbData = JSON.parse(zip.readAsText(databaseEntry));

    // Extract uploads
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      if (entry.entryName.startsWith('uploads/') && !entry.isDirectory) {
        const fileName = entry.name;
        const targetPath = path.join(uploadsDir, fileName);
        fs.writeFileSync(targetPath, entry.getData());
      }
    }

    // Check which tables are available in the database to avoid transaction crashes
    const tables = [
      'user',
      'category',
      'brand',
      'product',
      'offer',
      'blog',
      'hero',
      'order',
      'orderItem',
      'imageStore',
      'medicalTip',
      'setting',
      'indexingLog'
    ];

    const availableTables = {};
    for (const table of tables) {
      try {
        await prisma[table].findMany({ take: 1 });
        availableTables[table] = true;
      } catch (err) {
        console.warn(`Table "${table}" is not available in the database. It will be skipped during restore.`);
        availableTables[table] = false;
      }
    }

    // Restore Database records inside a Transaction
    await prisma.$transaction(async (tx) => {
      const upsertData = async (model, dataArray, idField = 'id') => {
        if (!dataArray || dataArray.length === 0) return;
        for (const item of dataArray) {
          const whereClause = {};
          whereClause[idField] = item[idField];
          try {
            await model.upsert({
              where: whereClause,
              update: item,
              create: item
            });
          } catch (e) {
            console.error(`Failed to upsert for ${item[idField]}:`, e.message);
          }
        }
      };

      // Upsert records in dependency order (if available)
      if (availableTables.user) await upsertData(tx.user, dbData.user);
      if (availableTables.category) await upsertData(tx.category, dbData.category);
      if (availableTables.brand) await upsertData(tx.brand, dbData.brand);
      if (availableTables.product) await upsertData(tx.product, dbData.product);
      if (availableTables.order) await upsertData(tx.order, dbData.order);
      if (availableTables.orderItem) await upsertData(tx.orderItem, dbData.orderItem);
      if (availableTables.offer) await upsertData(tx.offer, dbData.offer);
      if (availableTables.blog) await upsertData(tx.blog, dbData.blog);
      if (availableTables.hero) await upsertData(tx.hero, dbData.hero);
      if (availableTables.medicalTip) await upsertData(tx.medicalTip, dbData.medicalTip);
      if (availableTables.setting) await upsertData(tx.setting, dbData.setting, 'key');
      if (availableTables.indexingLog) await upsertData(tx.indexingLog, dbData.indexingLog);

      if (availableTables.imageStore && dbData.imageStore && dbData.imageStore.length > 0) {
        // Resolve binaries from ZIP first
        for (const row of dbData.imageStore) {
          const dataEntry = zip.getEntry(`imageStore/${row.id}_data.bin`);
          if (dataEntry) {
            row.data = dataEntry.getData();
          }
          const thumbEntry = zip.getEntry(`imageStore/${row.id}_thumb.bin`);
          if (thumbEntry) {
            row.thumbnailData = thumbEntry.getData();
          }
        }

        const imageStoresToInsert = dbData.imageStore.map(item => ({
          ...item,
          data: item.data ? (Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data.data || item.data)) : undefined,
          thumbnailData: item.thumbnailData ? (Buffer.isBuffer(item.thumbnailData) ? item.thumbnailData : Buffer.from(item.thumbnailData.data || item.thumbnailData)) : undefined
        }));
        await upsertData(tx.imageStore, imageStoresToInsert);
      }
    }, {
      maxWait: 10000,
      timeout: 120000 // Give it 2 minutes since upserting takes longer
    });

    res.json({ message: 'Backup restored successfully' });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore backup: ' + error.message });
  }
});

app.post('/api/admin/clean-base64-images', adminAuthenticate, async (req, res) => {
  const PLACEHOLDER_IMAGE = "https://placehold.co/400x400?text=No+Image";

  const HERO_DEFAULTS = {
    image: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=700&q=80",
    side1Image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80",
    side2Image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&q=80",
  };

  function isBase64Image(str) {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.startsWith('data:image/') || trimmed.startsWith('data:') || trimmed.includes(';base64,');
  }

  function cleanImagesList(imagesStr) {
    if (!imagesStr) return null;
    const list = imagesStr.split(',')
      .map(img => img.trim())
      .filter(img => img && !isBase64Image(img));
    return list.length > 0 ? list.join(',') : null;
  }

  function cleanSlidesJson(slidesStr) {
    if (!slidesStr) return null;
    try {
      const slides = JSON.parse(slidesStr);
      if (!Array.isArray(slides)) return slidesStr;
      let modified = false;
      const cleanedSlides = slides.map(slide => {
        if (slide && isBase64Image(slide.image)) {
          modified = true;
          return { ...slide, image: HERO_DEFAULTS.image };
        }
        return slide;
      });
      return modified ? JSON.stringify(cleanedSlides) : slidesStr;
    } catch (e) {
      return slidesStr;
    }
  }

  try {
    let totalUpdated = 0;

    // 1. Categories
    const categories = await prisma.category.findMany();
    for (const item of categories) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.category.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 2. Brands
    const brands = await prisma.brand.findMany();
    for (const item of brands) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.brand.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 3. Products
    const products = await prisma.product.findMany();
    for (const item of products) {
      let needsUpdate = false;
      const updateData = {};

      if (isBase64Image(item.image)) {
        needsUpdate = true;
        updateData.image = PLACEHOLDER_IMAGE;
      }

      if (item.images) {
        const cleanedImages = cleanImagesList(item.images);
        if (cleanedImages !== item.images) {
          needsUpdate = true;
          updateData.images = cleanedImages;
        }
      }

      if (needsUpdate) {
        totalUpdated++;
        await prisma.product.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }

    // 4. Offers
    const offers = await prisma.offer.findMany();
    for (const item of offers) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.offer.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }

    // 5. Blogs
    const blogs = await prisma.blog.findMany();
    for (const item of blogs) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.blog.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }

    // 6. Hero
    const heros = await prisma.hero.findMany();
    for (const item of heros) {
      let needsUpdate = false;
      const updateData = {};

      if (isBase64Image(item.image)) {
        needsUpdate = true;
        updateData.image = HERO_DEFAULTS.image;
      }
      if (isBase64Image(item.side1Image)) {
        needsUpdate = true;
        updateData.side1Image = HERO_DEFAULTS.side1Image;
      }
      if (isBase64Image(item.side2Image)) {
        needsUpdate = true;
        updateData.side2Image = HERO_DEFAULTS.side2Image;
      }
      if (isBase64Image(item.prod1Image)) {
        needsUpdate = true;
        updateData.prod1Image = null;
      }
      if (isBase64Image(item.prod2Image)) {
        needsUpdate = true;
        updateData.prod2Image = null;
      }
      if (isBase64Image(item.prod3Image)) {
        needsUpdate = true;
        updateData.prod3Image = null;
      }
      if (isBase64Image(item.prod4Image)) {
        needsUpdate = true;
        updateData.prod4Image = null;
      }
      if (item.slides) {
        const cleanedSlides = cleanSlidesJson(item.slides);
        if (cleanedSlides !== item.slides) {
          needsUpdate = true;
          updateData.slides = cleanedSlides;
        }
      }

      if (needsUpdate) {
        totalUpdated++;
        await prisma.hero.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }

    // 7. OrderItems
    const orderItems = await prisma.orderItem.findMany();
    for (const item of orderItems) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 8. MedicalTips
    const medicalTips = await prisma.medicalTip.findMany();
    for (const item of medicalTips) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.medicalTip.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    res.json({ message: 'تم تنظيف قاعدة البيانات بنجاح وحذف كافة الصور الـ Base64', count: totalUpdated });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تنظيف قاعدة البيانات: ' + error.message });
  }
});

app.get('/api/debug-images', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({ select: { id: true, name: true, image: true }, take: 10 });
    const products = await prisma.product.findMany({ select: { id: true, title: true, image: true, images: true }, take: 10 });
    res.json({ categories, products });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled API error:', err);
  const status = err.status || (err.message === 'Invalid file type' ? 400 : 500);
  res.status(status).json({ error: err.message || 'حدث خطأ في الخادم' });
});


async function runAutoCleanup() {
  console.log('[Auto-Cleanup] Starting background database cleanup for Base64 images...');
  const PLACEHOLDER_IMAGE = "https://placehold.co/400x400?text=No+Image";

  const HERO_DEFAULTS = {
    image: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=700&q=80",
    side1Image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80",
    side2Image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&q=80",
  };

  function isBase64Image(str) {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.startsWith('data:image/') || trimmed.startsWith('data:') || trimmed.includes(';base64,');
  }

  function cleanImagesList(imagesStr) {
    if (!imagesStr) return null;
    const list = imagesStr.split(',')
      .map(img => img.trim())
      .filter(img => img && !isBase64Image(img));
    return list.length > 0 ? list.join(',') : null;
  }

  function cleanSlidesJson(slidesStr) {
    if (!slidesStr) return null;
    try {
      const slides = JSON.parse(slidesStr);
      if (!Array.isArray(slides)) return slidesStr;
      let modified = false;
      const cleanedSlides = slides.map(slide => {
        if (slide && isBase64Image(slide.image)) {
          modified = true;
          return { ...slide, image: HERO_DEFAULTS.image };
        }
        return slide;
      });
      return modified ? JSON.stringify(cleanedSlides) : slidesStr;
    } catch (e) {
      return slidesStr;
    }
  }

  try {
    let totalUpdated = 0;

    // 1. Categories
    const categories = await prisma.category.findMany();
    for (const item of categories) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.category.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 2. Brands
    const brands = await prisma.brand.findMany();
    for (const item of brands) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.brand.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 3. Products
    const products = await prisma.product.findMany();
    for (const item of products) {
      let needsUpdate = false;
      const updateData = {};

      if (isBase64Image(item.image)) {
        needsUpdate = true;
        updateData.image = PLACEHOLDER_IMAGE;
      }

      if (item.images) {
        const cleanedImages = cleanImagesList(item.images);
        if (cleanedImages !== item.images) {
          needsUpdate = true;
          updateData.images = cleanedImages;
        }
      }

      if (needsUpdate) {
        totalUpdated++;
        await prisma.product.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }

    // 4. Offers
    const offers = await prisma.offer.findMany();
    for (const item of offers) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.offer.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }

    // 5. Blogs
    const blogs = await prisma.blog.findMany();
    for (const item of blogs) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.blog.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }

    // 6. Hero
    const heros = await prisma.hero.findMany();
    for (const item of heros) {
      let needsUpdate = false;
      const updateData = {};

      if (isBase64Image(item.image)) {
        needsUpdate = true;
        updateData.image = HERO_DEFAULTS.image;
      }
      if (isBase64Image(item.side1Image)) {
        needsUpdate = true;
        updateData.side1Image = HERO_DEFAULTS.side1Image;
      }
      if (isBase64Image(item.side2Image)) {
        needsUpdate = true;
        updateData.side2Image = HERO_DEFAULTS.side2Image;
      }
      if (isBase64Image(item.prod1Image)) {
        needsUpdate = true;
        updateData.prod1Image = null;
      }
      if (isBase64Image(item.prod2Image)) {
        needsUpdate = true;
        updateData.prod2Image = null;
      }
      if (isBase64Image(item.prod3Image)) {
        needsUpdate = true;
        updateData.prod3Image = null;
      }
      if (isBase64Image(item.prod4Image)) {
        needsUpdate = true;
        updateData.prod4Image = null;
      }
      if (item.slides) {
        const cleanedSlides = cleanSlidesJson(item.slides);
        if (cleanedSlides !== item.slides) {
          needsUpdate = true;
          updateData.slides = cleanedSlides;
        }
      }

      if (needsUpdate) {
        totalUpdated++;
        await prisma.hero.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }

    // 7. OrderItems
    const orderItems = await prisma.orderItem.findMany();
    for (const item of orderItems) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    // 8. MedicalTips
    const medicalTips = await prisma.medicalTip.findMany();
    for (const item of medicalTips) {
      if (isBase64Image(item.image)) {
        totalUpdated++;
        await prisma.medicalTip.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }

    if (totalUpdated > 0) {
      console.log(`[Auto-Cleanup] Completed. Cleaned up Base64 images from ${totalUpdated} database records.`);
    } else {
      console.log(`[Auto-Cleanup] No Base64 images found. Database is clean.`);
    }
  } catch (error) {
    console.error('[Auto-Cleanup] Error during background database cleanup:', error);
  }
}

// ── Meta Conversions API (CAPI) Helper ───────────────────────────
const sendConversionsApiEvent = async ({
  eventName,
  eventId,
  eventSourceUrl = 'https://the-vitahub.com/',
  customerIp = '',
  userAgent = '',
  fbp = null,
  fbc = null,
  customData = {},
  userData = {}
}) => {
  try {
    const pixelId = process.env.META_PIXEL_ID || '2785073648526058';
    const accessToken = process.env.META_ACCESS_TOKEN || process.env.META_CAPI_TOKEN || process.env.META_PIXEL_ACCESS_TOKEN || '';
    if (!pixelId || !accessToken) {
      return { success: false, reason: 'META_ACCESS_TOKEN or META_PIXEL_ID not configured on server' };
    }

    const hashSha256 = (str) => {
      if (!str || typeof str !== 'string') return null;
      const clean = str.trim().toLowerCase();
      if (!clean) return null;
      return crypto.createHash('sha256').update(clean).digest('hex');
    };

    const hashPhoneSha256 = (phone) => {
      if (!phone || typeof phone !== 'string') return null;
      let digits = phone.replace(/\D/g, '');
      if (!digits) return null;
      if (digits.startsWith('01') && digits.length === 11) {
        digits = '20' + digits.substring(1);
      } else if (digits.startsWith('1') && digits.length === 10) {
        digits = '20' + digits;
      } else if (digits.startsWith('0020')) {
        digits = digits.substring(2);
      }
      return crypto.createHash('sha256').update(digits).digest('hex');
    };

    const user_data = {};

    const emHash = hashSha256(userData.email || userData.customerEmail);
    if (emHash) user_data.em = [emHash];

    const phHash = hashPhoneSha256(userData.phone || userData.customerPhone);
    if (phHash) user_data.ph = [phHash];

    const fullName = (userData.name || userData.customerName || '').trim();
    if (fullName) {
      const parts = fullName.split(/\s+/);
      const fnHash = hashSha256(parts[0]);
      if (fnHash) user_data.fn = [fnHash];
      if (parts.length > 1) {
        const lnHash = hashSha256(parts.slice(1).join(' '));
        if (lnHash) user_data.ln = [lnHash];
      }
    }

    const ctHash = hashSha256(userData.city || userData.governorate);
    if (ctHash) user_data.ct = [ctHash];

    user_data.co = [crypto.createHash('sha256').update('eg').digest('hex')];

    if (customerIp && typeof customerIp === 'string') {
      const cleanIp = customerIp.split(',')[0].trim();
      if (cleanIp && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
        user_data.client_ip_address = cleanIp;
      }
    }
    if (userAgent && typeof userAgent === 'string') {
      user_data.client_user_agent = userAgent;
    }
    if (fbp && typeof fbp === 'string') {
      user_data.fbp = fbp;
    }
    if (fbc && typeof fbc === 'string') {
      user_data.fbc = fbc;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: eventSourceUrl || 'https://the-vitahub.com/',
          event_id: eventId ? String(eventId) : undefined,
          user_data,
          custom_data: customData || {}
        }
      ]
    };

    const response = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      console.error(`[Meta CAPI Error] Event "${eventName}" (${eventId}):`, result);
      return { success: false, error: result };
    }
    console.log(`[Meta CAPI Success] Event "${eventName}" (${eventId}) dispatched. Events received: ${result.events_received}`);
    return { success: true, result };
  } catch (error) {
    console.error(`[Meta CAPI Exception] Event "${eventName}":`, error.message);
    return { success: false, error: error.message };
  }
};

// ── Pixel Tracking & Analytics Routes ───────────────────────────
app.post('/api/pixel-events', optionalAuthenticate, asyncHandler(async (req, res) => {
  const { eventName, url, metadata, eventId, fbp, fbc } = req.body;
  if (!eventName) {
    return res.status(400).json({ error: 'Event name is required' });
  }

  const customerIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  const metaObj = metadata && typeof metadata === 'object' ? metadata : (metadata ? { rawMetadata: metadata } : {});
  const storedMetadata = JSON.stringify({
    ...metaObj,
    ...(eventId ? { eventId } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {})
  });

  const event = await prisma.pixelEvent.create({
    data: {
      eventName: normalizeString(eventName, 100),
      url: url ? normalizeString(url, 2048) : null,
      customerIp: typeof customerIp === 'string' ? normalizeString(customerIp, 100) : null,
      userAgent: typeof userAgent === 'string' ? normalizeString(userAgent, 500) : null,
      metadata: storedMetadata
    }
  });

  // For non-Purchase events, dispatch via server-to-server CAPI immediately.
  // Purchase is already handled inside POST /api/orders once order creation succeeds.
  if (eventName !== 'Purchase') {
    let customData = {};
    if (metadata && typeof metadata === 'object') {
      if (metadata.value || metadata.price) {
        customData.value = Number(metadata.value || metadata.price) || 0;
        customData.currency = 'EGP';
      }
      if (metadata.title || metadata.content_name) {
        customData.content_name = metadata.title || metadata.content_name;
      }
      if (metadata.id || (metadata.content_ids && Array.isArray(metadata.content_ids))) {
        customData.content_ids = metadata.content_ids || [metadata.id];
        customData.content_type = 'product';
      }
      if (metadata.search_string || metadata.query) {
        customData.search_string = metadata.search_string || metadata.query;
      }
      if (metadata.cart && Array.isArray(metadata.cart)) {
        customData.contents = metadata.cart.map(i => ({
          id: String(i.id || ''),
          quantity: Number(i.quantity) || 1,
          item_price: Number(i.price) || 0
        }));
        customData.num_items = metadata.cart.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
      }
    }

    sendConversionsApiEvent({
      eventName,
      eventId: eventId || event.id,
      eventSourceUrl: url || 'https://the-vitahub.com/',
      customerIp,
      userAgent,
      fbp,
      fbc,
      customData,
      userData: req.user ? {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        city: req.user.governorate
      } : {}
    }).catch(err => console.error(`Error sending CAPI ${eventName} event:`, err));
  }

  res.status(201).json({ success: true, eventId: event.id });
}));

app.get('/api/admin/pixel-events', adminAuthenticate, asyncHandler(async (req, res) => {
  const limit = parsePositiveInt(req.query.limit, 100, 1000);
  const offset = parsePositiveInt(req.query.offset, 0, 100000);
  const search = req.query.search || '';

  const where = {};
  if (search) {
    where.OR = [
      { eventName: { contains: search, mode: 'insensitive' } },
      { url: { contains: search, mode: 'insensitive' } },
      { customerIp: { contains: search, mode: 'insensitive' } },
      { metadata: { contains: search, mode: 'insensitive' } }
    ];
  }

  const [events, total] = await Promise.all([
    prisma.pixelEvent.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.pixelEvent.count({ where })
  ]);

  res.json({ events, total });
}));

app.get('/api/admin/pixel-stats', adminAuthenticate, asyncHandler(async (req, res) => {
  try {
    const aggregations = await prisma.pixelEvent.groupBy({
      by: ['eventName'],
      _count: {
        _all: true
      }
    });

    const uniqueIps = await prisma.pixelEvent.findMany({
      select: { customerIp: true },
      distinct: ['customerIp'],
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentEvents = await prisma.pixelEvent.findMany({
      where: {
        createdAt: {
          gte: thirtyDaysAgo
        }
      },
      select: {
        eventName: true,
        createdAt: true
      }
    });

    const dailyStats = {};
    recentEvents.forEach(e => {
      const day = e.createdAt.toISOString().slice(0, 10);
      if (!dailyStats[day]) {
        dailyStats[day] = { date: day, PageView: 0, ViewContent: 0, AddToCart: 0, InitiateCheckout: 0, Purchase: 0, total: 0 };
      }
      const evt = e.eventName;
      if (dailyStats[day][evt] !== undefined) {
        dailyStats[day][evt]++;
      }
      dailyStats[day].total++;
    });

    const chartData = Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      eventCounts: aggregations.map(a => ({ eventName: a.eventName, count: a._count._all })),
      uniqueVisitors: uniqueIps.filter(ip => ip.customerIp).length,
      chartData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  initWhatsApp();
  
  // Run background cleanup on startup
  runAutoCleanup();
  
  // Run background cleanup every 24 hours
  setInterval(runAutoCleanup, 24 * 60 * 60 * 1000);
});
