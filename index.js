const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const fs = require('fs');

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Multer Configuration ──────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB Limit
});

// ── Upload Endpoints ──────────────────────────────────────────
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

app.post('/api/upload-multiple', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const urls = req.files.map(file => `/uploads/${file.filename}`);
  res.json({ urls });
});

// ── AI Endpoints ──────────────────────────────────────────────
app.post('/api/ai/generate', async (req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || ''}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (error) {
    console.error('AI Proxy Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Health Check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Mithaly Backend is running smoothly! 🚀' });
});

// ── Products Routes ───────────────────────────────────────────
// ── Brands Endpoints ──────────────────────────────────────────
app.get('/api/brands', async (req, res) => {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/brands', async (req, res) => {
  const { name, image } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Brand name required' });
  try {
    // Use upsert to avoid duplicate name errors
    const brand = await prisma.brand.upsert({
      where: { name: name.trim() },
      update: { image: image || undefined },
      create: { name: name.trim(), image: image || null }
    });
    res.status(201).json(brand);
  } catch (error) {
    console.error('POST /api/brands error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/brands/:id', async (req, res) => {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: req.params.id },
      include: { products: true }
    });
    if (!brand) return res.status(404).json({ error: 'Not found' });
    res.json(brand);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/brands/:id', async (req, res) => {
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
    const products = await prisma.product.findMany({
      include: { category: true, brand: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true, brand: true }
    });
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { title, desc, features, price, oldPrice, discountType, discountValue, image, images, sizes, tag, seoKeywords, seoDesc, categoryId, brandId, sizesPrices, productSpecs, keyInfo, certifications, overview, warnings, disclaimer, directions, ingredients, supplementFacts } = req.body;
  try {
    const product = await prisma.product.create({
      data: { title, desc, features, price, oldPrice, discountType, discountValue, image, images, sizes, tag, seoKeywords, seoDesc, categoryId, brandId, sizesPrices, productSpecs, keyInfo, certifications, overview, warnings, disclaimer, directions, ingredients, supplementFacts }
    });
    res.status(201).json(product);
  } catch (error) {
    console.error('POST /api/products error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/products/:id', async (req, res) => {
  const { title, desc, features, price, oldPrice, discountType, discountValue, image, images, sizes, tag, seoKeywords, seoDesc, categoryId, brandId, sizesPrices, productSpecs, keyInfo, certifications, overview, warnings, disclaimer, directions, ingredients, supplementFacts } = req.body;
  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { title, desc, features, price, oldPrice, discountType, discountValue, image, images, sizes, tag, seoKeywords, seoDesc, categoryId, brandId, sizesPrices, productSpecs, keyInfo, certifications, overview, warnings, disclaimer, directions, ingredients, supplementFacts }
    });
    res.json(product);
  } catch (error) {
    console.error('PATCH /api/products error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Categories Routes ─────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany();
    res.json(categories);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', async (req, res) => {
  const { name, image, href } = req.body;
  try {
    const category = await prisma.category.create({
      data: { name, image, href }
    });
    res.status(201).json(category);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/categories/:id', async (req, res) => {
  const { name, image, href, count } = req.body;
  try {
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: { name, image, href, count }
    });
    res.json(category);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
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

app.patch('/api/offers/:id', async (req, res) => {
  const { title, discount, image } = req.body;
  try {
    const offer = await prisma.offer.update({
      where: { id: req.params.id },
      data: { title, discount, image }
    });
    res.json(offer);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/offers/:id', async (req, res) => {
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

app.patch('/api/blog/:id', async (req, res) => {
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

app.delete('/api/blog/:id', async (req, res) => {
  try {
    await prisma.blog.delete({ where: { id: req.params.id } });
    res.json({ message: 'Post deleted' });
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

app.patch('/api/hero', async (req, res) => {
  try {
    const hero = await prisma.hero.upsert({
      where: { id: 'hero-section' },
      update: req.body,
      create: { id: 'hero-section', ...req.body }
    });
    res.json(hero);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Error Handling Middleware ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Multer Error: ${err.message}` });
  }
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
