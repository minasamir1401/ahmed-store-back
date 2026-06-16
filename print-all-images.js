require('dotenv').config();

// Fallback to localhost if running directly on host rather than inside Docker
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', '@localhost:5432');
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Printing all images in database ---\n');

  // 1. Categories
  const categories = await prisma.category.findMany({ select: { id: true, name: true, image: true } });
  console.log(`=== Categories (${categories.length}) ===`);
  categories.forEach(item => {
    console.log(`ID: ${item.id} | Name: ${item.name} | Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
  });

  // 2. Brands
  const brands = await prisma.brand.findMany({ select: { id: true, name: true, image: true } });
  console.log(`\n=== Brands (${brands.length}) ===`);
  brands.forEach(item => {
    console.log(`ID: ${item.id} | Name: ${item.name} | Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
  });

  // 3. Products
  const products = await prisma.product.findMany({ select: { id: true, title: true, image: true, images: true } });
  console.log(`\n=== Products (${products.length}) ===`);
  products.forEach(item => {
    console.log(`ID: ${item.id} | Title: ${item.title}`);
    console.log(`  - Main Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
    console.log(`  - Gallery: ${item.images ? item.images.substring(0, 120) + (item.images.length > 120 ? '...' : '') : 'null'}`);
  });

  // 4. Offers
  const offers = await prisma.offer.findMany({ select: { id: true, title: true, image: true } });
  console.log(`\n=== Offers (${offers.length}) ===`);
  offers.forEach(item => {
    console.log(`ID: ${item.id} | Title: ${item.title} | Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
  });

  // 5. Blogs
  const blogs = await prisma.blog.findMany({ select: { id: true, title: true, image: true } });
  console.log(`\n=== Blogs (${blogs.length}) ===`);
  blogs.forEach(item => {
    console.log(`ID: ${item.id} | Title: ${item.title} | Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
  });

  // 6. Hero
  const heros = await prisma.hero.findMany();
  console.log(`\n=== Hero Section (${heros.length}) ===`);
  heros.forEach(item => {
    console.log(`ID: ${item.id}`);
    console.log(`  - Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
    console.log(`  - Side1Image: ${item.side1Image ? item.side1Image.substring(0, 120) + (item.side1Image.length > 120 ? '...' : '') : 'null'}`);
    console.log(`  - Side2Image: ${item.side2Image ? item.side2Image.substring(0, 120) + (item.side2Image.length > 120 ? '...' : '') : 'null'}`);
    console.log(`  - Slides: ${item.slides ? item.slides.substring(0, 120) + (item.slides.length > 120 ? '...' : '') : 'null'}`);
  });

  // 7. MedicalTips
  const tips = await prisma.medicalTip.findMany({ select: { id: true, title: true, image: true } });
  console.log(`\n=== Medical Tips (${tips.length}) ===`);
  tips.forEach(item => {
    console.log(`ID: ${item.id} | Title: ${item.title} | Image: ${item.image ? item.image.substring(0, 120) + (item.image.length > 120 ? '...' : '') : 'null'}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
