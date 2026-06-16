require('dotenv').config();

// Fallback to localhost if running directly on host rather than inside Docker
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@postgres:5432', '@localhost:5432');
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PLACEHOLDER_IMAGE = "https://placehold.co/400x400?text=No+Image";

const HERO_DEFAULTS = {
  image: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=700&q=80",
  side1Image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80",
  side2Image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&q=80",
};

// Function to check if a string is a base64 data URL or similar base64 encoding
function isBase64Image(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return trimmed.startsWith('data:image/') || trimmed.startsWith('data:') || trimmed.includes(';base64,');
}

// Function to process comma-separated images string
function cleanImagesList(imagesStr) {
  if (!imagesStr) return null;
  const list = imagesStr.split(',')
    .map(img => img.trim())
    .filter(img => img && !isBase64Image(img));
  return list.length > 0 ? list.join(',') : null;
}

// Clean slides JSON string
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

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--commit');

  console.log(`=========================================`);
  console.log(`Database Cleanup: Base64 Images Clean-up Script`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (No changes will be saved)' : 'COMMIT (Changes WILL be saved to the database)'}`);
  console.log(`To apply changes, run: node clean-base64-images.js --commit`);
  console.log(`=========================================\n`);

  let totalScanned = 0;
  let totalToUpdate = 0;

  // 1. Categories
  console.log('--- Checking Categories ---');
  const categories = await prisma.category.findMany();
  for (const item of categories) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[Category] ID: ${item.id}, Name: ${item.name} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.category.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }
  }

  // 2. Brands
  console.log('\n--- Checking Brands ---');
  const brands = await prisma.brand.findMany();
  for (const item of brands) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[Brand] ID: ${item.id}, Name: ${item.name} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.brand.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }
  }

  // 3. Products
  console.log('\n--- Checking Products ---');
  const products = await prisma.product.findMany();
  for (const item of products) {
    totalScanned++;
    let needsUpdate = false;
    const updateData = {};

    if (isBase64Image(item.image)) {
      needsUpdate = true;
      updateData.image = PLACEHOLDER_IMAGE;
      console.log(`[Product Image] ID: ${item.id}, Title: ${item.title} - Has Base64 main image.`);
    }

    if (item.images) {
      const cleanedImages = cleanImagesList(item.images);
      if (cleanedImages !== item.images) {
        needsUpdate = true;
        updateData.images = cleanedImages;
        console.log(`[Product Gallery] ID: ${item.id}, Title: ${item.title} - Has Base64 image in gallery.`);
      }
    }

    if (needsUpdate) {
      totalToUpdate++;
      if (!isDryRun) {
        await prisma.product.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }
  }

  // 4. Offers
  console.log('\n--- Checking Offers ---');
  const offers = await prisma.offer.findMany();
  for (const item of offers) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[Offer] ID: ${item.id}, Title: ${item.title} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.offer.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }
  }

  // 5. Blogs
  console.log('\n--- Checking Blogs ---');
  const blogs = await prisma.blog.findMany();
  for (const item of blogs) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[Blog] ID: ${item.id}, Title: ${item.title} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.blog.update({
          where: { id: item.id },
          data: { image: PLACEHOLDER_IMAGE }
        });
      }
    }
  }

  // 6. Hero
  console.log('\n--- Checking Hero Section ---');
  const heros = await prisma.hero.findMany();
  for (const item of heros) {
    totalScanned++;
    let needsUpdate = false;
    const updateData = {};

    if (isBase64Image(item.image)) {
      needsUpdate = true;
      updateData.image = HERO_DEFAULTS.image;
      console.log(`[Hero Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.side1Image)) {
      needsUpdate = true;
      updateData.side1Image = HERO_DEFAULTS.side1Image;
      console.log(`[Hero Side1Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.side2Image)) {
      needsUpdate = true;
      updateData.side2Image = HERO_DEFAULTS.side2Image;
      console.log(`[Hero Side2Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.prod1Image)) {
      needsUpdate = true;
      updateData.prod1Image = null;
      console.log(`[Hero Prod1Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.prod2Image)) {
      needsUpdate = true;
      updateData.prod2Image = null;
      console.log(`[Hero Prod2Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.prod3Image)) {
      needsUpdate = true;
      updateData.prod3Image = null;
      console.log(`[Hero Prod3Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (isBase64Image(item.prod4Image)) {
      needsUpdate = true;
      updateData.prod4Image = null;
      console.log(`[Hero Prod4Image] ID: ${item.id} - Has Base64 Image.`);
    }
    if (item.slides) {
      const cleanedSlides = cleanSlidesJson(item.slides);
      if (cleanedSlides !== item.slides) {
        needsUpdate = true;
        updateData.slides = cleanedSlides;
        console.log(`[Hero Slides] ID: ${item.id} - Has Base64 Image in slides.`);
      }
    }

    if (needsUpdate) {
      totalToUpdate++;
      if (!isDryRun) {
        await prisma.hero.update({
          where: { id: item.id },
          data: updateData
        });
      }
    }
  }

  // 7. OrderItem
  console.log('\n--- Checking OrderItems ---');
  const orderItems = await prisma.orderItem.findMany();
  for (const item of orderItems) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[OrderItem] ID: ${item.id}, Title: ${item.title} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }
  }

  // 8. MedicalTip
  console.log('\n--- Checking MedicalTips ---');
  const medicalTips = await prisma.medicalTip.findMany();
  for (const item of medicalTips) {
    totalScanned++;
    if (isBase64Image(item.image)) {
      totalToUpdate++;
      console.log(`[MedicalTip] ID: ${item.id}, Title: ${item.title} - Has Base64 Image.`);
      if (!isDryRun) {
        await prisma.medicalTip.update({
          where: { id: item.id },
          data: { image: null }
        });
      }
    }
  }

  console.log(`\n=========================================`);
  console.log(`Scan completed.`);
  console.log(`Total scanned records: ${totalScanned}`);
  console.log(`Total records with Base64 images found: ${totalToUpdate}`);
  if (isDryRun) {
    console.log(`NO changes were made. Run with '--commit' to update the database.`);
  } else {
    console.log(`Successfully updated ${totalToUpdate} records in the database. ✅`);
  }
  console.log(`=========================================`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
