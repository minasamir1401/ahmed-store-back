const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function main() {
  const backupPath = path.join(__dirname, 'backup_data.json');
  if (!fs.existsSync(backupPath)) {
    console.log('No backup_data.json file found. Skipping import.');
    return;
  }

  console.log('Reading backup_data.json...');
  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  console.log('Checking database connection and state...');
  try {
    // Check if we already have categories or products in the PostgreSQL database
    const existingCategories = await prisma.category.count();
    const existingProducts = await prisma.product.count();
    
    if (existingCategories > 0 || existingProducts > 0) {
      console.log('Database already contains categories or products. Skipping import to prevent duplicates.');
      return;
    }
  } catch (err) {
    console.error('Failed to query remote database:', err.message);
    process.exit(1);
  }

  console.log('Starting data migration to PostgreSQL...');

  // 1. Migrate Users
  if (data.users && data.users.length > 0) {
    console.log(`Migrating ${data.users.length} users...`);
    for (const u of data.users) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: {
          id: u.id,
          email: u.email,
          password: u.password,
          name: u.name,
          phone: u.phone,
          role: u.role,
          cart: u.cart,
          resetOtpCode: u.resetOtpCode,
          resetOtpExpires: u.resetOtpExpires ? new Date(u.resetOtpExpires) : null,
          createdAt: new Date(u.createdAt),
          updatedAt: new Date(u.updatedAt)
        }
      });
    }
  }

  // 2. Migrate Categories
  if (data.categories && data.categories.length > 0) {
    console.log(`Migrating ${data.categories.length} categories...`);
    for (const c of data.categories) {
      await prisma.category.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          name: c.name,
          nameEn: c.nameEn,
          image: c.image,
          count: c.count,
          href: c.href,
          createdAt: new Date(c.createdAt)
        }
      });
    }
  }

  // 3. Migrate Brands
  if (data.brands && data.brands.length > 0) {
    console.log(`Migrating ${data.brands.length} brands...`);
    for (const b of data.brands) {
      await prisma.brand.upsert({
        where: { id: b.id },
        update: {},
        create: {
          id: b.id,
          name: b.name,
          nameEn: b.nameEn,
          image: b.image,
          createdAt: new Date(b.createdAt)
        }
      });
    }
  }

  // 4. Migrate Products
  if (data.products && data.products.length > 0) {
    console.log(`Migrating ${data.products.length} products...`);
    for (const p of data.products) {
      await prisma.product.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id,
          title: p.title,
          titleEn: p.titleEn,
          desc: p.desc,
          descEn: p.descEn,
          features: p.features,
          featuresEn: p.featuresEn,
          price: p.price,
          oldPrice: p.oldPrice,
          discountType: p.discountType,
          discountValue: p.discountValue,
          image: p.image,
          images: p.images,
          imageAlt: p.imageAlt,
          imageWidth: p.imageWidth,
          imageHeight: p.imageHeight,
          sizes: p.sizes,
          tag: p.tag,
          seoKeywords: p.seoKeywords,
          seoDesc: p.seoDesc,
          categoryId: p.categoryId,
          brandId: p.brandId,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          sizeOptions: p.sizeOptions,
          specifications: p.specifications,
          keyInfo: p.keyInfo,
          certifications: p.certifications,
          usage: p.usage,
          usageEn: p.usageEn,
          ingredients: p.ingredients,
          ingredientsEn: p.ingredientsEn,
          supplementFacts: p.supplementFacts,
          warnings: p.warnings,
          warningsEn: p.warningsEn,
          disclaimer: p.disclaimer,
          disclaimerEn: p.disclaimerEn,
          seoKeywordsEn: p.seoKeywordsEn,
          seoDescEn: p.seoDescEn,
          dosageCalculator: p.dosageCalculator,
          faqs: p.faqs,
          expiryDate: p.expiryDate
        }
      });
    }
  }

  // 5. Migrate Offers
  if (data.offers && data.offers.length > 0) {
    console.log(`Migrating ${data.offers.length} offers...`);
    for (const o of data.offers) {
      await prisma.offer.upsert({
        where: { id: o.id },
        update: {},
        create: {
          id: o.id,
          title: o.title,
          discount: o.discount,
          image: o.image,
          productId: o.productId,
          createdAt: new Date(o.createdAt)
        }
      });
    }
  }

  // 6. Migrate Blogs
  if (data.blogs && data.blogs.length > 0) {
    console.log(`Migrating ${data.blogs.length} blogs...`);
    for (const bl of data.blogs) {
      await prisma.blog.upsert({
        where: { id: bl.id },
        update: {},
        create: {
          id: bl.id,
          title: bl.title,
          excerpt: bl.excerpt,
          content: bl.content,
          image: bl.image,
          category: bl.category,
          readTime: bl.readTime,
          date: bl.date,
          createdAt: new Date(bl.createdAt)
        }
      });
    }
  }

  // 7. Migrate Medical Tips
  if (data.medicalTips && data.medicalTips.length > 0) {
    console.log(`Migrating ${data.medicalTips.length} medical tips...`);
    for (const tip of data.medicalTips) {
      await prisma.medicalTip.upsert({
        where: { id: tip.id },
        update: {},
        create: {
          id: tip.id,
          title: tip.title,
          titleEn: tip.titleEn,
          content: tip.content,
          contentEn: tip.contentEn,
          image: tip.image,
          createdAt: new Date(tip.createdAt),
          updatedAt: new Date(tip.updatedAt)
        }
      });
    }
  }

  // 8. Migrate Heroes
  if (data.heroes && data.heroes.length > 0) {
    console.log(`Migrating ${data.heroes.length} hero sections...`);
    for (const h of data.heroes) {
      await prisma.hero.upsert({
        where: { id: h.id },
        update: {},
        create: {
          id: h.id,
          title: h.title,
          subtitle: h.subtitle,
          image: h.image,
          buttonText: h.buttonText,
          buttonLink: h.buttonLink,
          side1Title: h.side1Title,
          side1Desc: h.side1Desc,
          side1Image: h.side1Image,
          side1Link: h.side1Link,
          side2Title: h.side2Title,
          side2Desc: h.side2Desc,
          side2Image: h.side2Image,
          side2Link: h.side2Link,
          prod1Id: h.prod1Id,
          prod1Image: h.prod1Image,
          prod1Type: h.prod1Type,
          prod2Id: h.prod2Id,
          prod2Image: h.prod2Image,
          prod2Type: h.prod2Type,
          prod3Id: h.prod3Id,
          prod3Image: h.prod3Image,
          prod3Type: h.prod3Type,
          prod4Id: h.prod4Id,
          prod4Image: h.prod4Image,
          prod4Type: h.prod4Type,
          slides: h.slides,
          updatedAt: new Date(h.updatedAt)
        }
      });
    }
  }

  // 9. Migrate Settings
  if (data.settings && data.settings.length > 0) {
    console.log(`Migrating ${data.settings.length} settings...`);
    for (const s of data.settings) {
      await prisma.setting.upsert({
        where: { key: s.key },
        update: {},
        create: {
          key: s.key,
          value: s.value,
          updatedAt: new Date(s.updatedAt)
        }
      });
    }
  }

  console.log('Data migration to PostgreSQL completed successfully! 🎉');
  
  // Rename backup file so it doesn't run again on next start
  try {
    const processedPath = path.join(__dirname, 'backup_data.json.processed');
    fs.renameSync(backupPath, processedPath);
    console.log('Renamed backup_data.json to backup_data.json.processed');
  } catch (err) {
    console.warn('Could not rename backup file:', err.message);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
