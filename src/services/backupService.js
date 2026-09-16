const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

function getExtensionFromMime(mimeType, url) {
  if (mimeType) {
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('avif')) return 'avif';
  }
  const cleanUrl = url.split('?')[0];
  const ext = path.extname(cleanUrl).toLowerCase().replace('.', '');
  if (['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

async function downloadAndCacheImage(url, baseName, uploadsDir) {
  if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    const ext = getExtensionFromMime(contentType, url);
    const fileName = `${baseName}.${ext}`;
    const targetPath = path.join(uploadsDir, fileName);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 200) {
      return null;
    }

    fs.writeFileSync(targetPath, buffer);
    return `/uploads/${fileName}`;
  } catch (err) {
    clearTimeout(timeoutId);
    return null;
  }
}

async function generateFullStoreBackup(prisma, uploadsDir) {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const knownTables = [
    'user',
    'category',
    'brand',
    'product',
    'offer',
    'blog',
    'hero',
    'order',
    'orderItem',
    'medicalTip',
    'setting',
    'indexingLog',
    'whatsAppSession',
    'pixelEvent'
  ];

  const dynamicTables = Object.keys(prisma).filter(
    (k) => !k.startsWith('_') && !k.startsWith('$') && k !== 'constructor' && typeof prisma[k]?.findMany === 'function'
  );

  const tables = Array.from(new Set([...knownTables, ...dynamicTables]));

  const dbData = {};
  const recordCounts = {};
  for (const table of tables) {
    try {
      if (prisma[table]) {
        const rows = await prisma[table].findMany();
        dbData[table] = rows;
        recordCounts[table] = rows.length;
      } else {
        dbData[table] = [];
        recordCounts[table] = 0;
      }
    } catch (err) {
      console.warn(`[Backup] Table "${table}" fetch warning: ${err.message}`);
      dbData[table] = [];
      recordCounts[table] = 0;
    }
  }

  // Ensure all products have their images saved locally into uploads/ before zipping
  if (dbData.product && dbData.product.length > 0) {
    for (let i = 0; i < dbData.product.length; i++) {
      const p = dbData.product[i];

      // Download main image if still external
      if (p.image && (p.image.startsWith('http://') || p.image.startsWith('https://'))) {
        const localMain = await downloadAndCacheImage(p.image, `prod-${p.id}-main`, uploadsDir);
        if (localMain) {
          p.image = localMain;
          await prisma.product.update({
            where: { id: p.id },
            data: { image: localMain }
          }).catch(() => {});
        }
      }

      // Download gallery images if still external
      if (p.images) {
        try {
          const parsed = JSON.parse(p.images);
          if (Array.isArray(parsed) && parsed.length > 0) {
            let changed = false;
            const updated = [];
            for (let g = 0; g < parsed.length; g++) {
              const gUrl = parsed[g];
              if (typeof gUrl === 'string' && (gUrl.startsWith('http://') || gUrl.startsWith('https://'))) {
                const localG = await downloadAndCacheImage(gUrl, `prod-${p.id}-gallery-${g}`, uploadsDir);
                if (localG) {
                  updated.push(localG);
                  changed = true;
                } else {
                  updated.push(gUrl);
                }
              } else {
                updated.push(gUrl);
              }
            }
            if (changed) {
              p.images = JSON.stringify(updated);
              await prisma.product.update({
                where: { id: p.id },
                data: { images: p.images }
              }).catch(() => {});
            }
          }
        } catch (e) {}
      }
    }
  }

  const zip = new AdmZip();

  // 1. Pack database.json (contains 100% of all tables)
  zip.addFile('database.json', Buffer.from(JSON.stringify(dbData, null, 2), 'utf8'));

  // 2. Pack manifest.json with metadata and table record counts
  let uploadFilesCount = 0;
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size > 0) {
          zip.addLocalFile(filePath, 'uploads');
          uploadFilesCount++;
        }
      } catch (e) {}
    }
  }

  const manifest = {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    description: 'Comprehensive store backup containing 100% database tables, logs, settings, and media files',
    tables: recordCounts,
    totalRecords: Object.values(recordCounts).reduce((acc, c) => acc + c, 0),
    uploadedFilesCount: uploadFilesCount
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  return zip.toBuffer();
}

async function restoreFullStoreBackup(prisma, zipBuffer, uploadsDir, currentAdminUser) {
  if (!zipBuffer || zipBuffer.length === 0) {
    throw new Error('Empty backup file provided');
  }

  const zip = new AdmZip(zipBuffer);
  const databaseEntry = zip.getEntry('database.json');
  if (!databaseEntry) {
    throw new Error('Invalid backup archive: database.json is missing');
  }

  const dbData = JSON.parse(zip.readAsText(databaseEntry));

  // 1. Extract uploads to uploadsDir
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  let extractedCount = 0;
  const zipEntries = zip.getEntries();
  for (const entry of zipEntries) {
    if (entry.entryName.startsWith('uploads/') && !entry.isDirectory) {
      const fileName = entry.name;
      if (fileName) {
        const targetPath = path.join(uploadsDir, fileName);
        fs.writeFileSync(targetPath, entry.getData());
        extractedCount++;
      }
    }
  }

  // 2. Prepare and sanitize categories (preserving exact IDs)
  const categoryMap = new Map();
  const rawCategories = Array.isArray(dbData.category) ? dbData.category : [];
  const sanitizedCategories = rawCategories.map((c) => {
    categoryMap.set(c.id, c);
    return {
      id: c.id,
      name: c.name,
      nameEn: c.nameEn || null,
      image: c.image || null,
      count: typeof c.count === 'number' ? c.count : 0,
      href: c.href || null,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date()
    };
  });

  // Ensure at least one default category exists for orphaned products
  let defaultCategory = sanitizedCategories[0];
  if (!defaultCategory) {
    defaultCategory = {
      id: 'default-cat-id',
      name: 'فيتامينات ومكملات',
      nameEn: 'Vitamins & Supplements',
      image: null,
      count: 0,
      href: null,
      createdAt: new Date()
    };
    sanitizedCategories.push(defaultCategory);
    categoryMap.set(defaultCategory.id, defaultCategory);
  }

  // 3. Prepare and sanitize brands (preserving exact IDs)
  const brandMap = new Map();
  const rawBrands = Array.isArray(dbData.brand) ? dbData.brand : [];
  const sanitizedBrands = rawBrands.map((b) => {
    brandMap.set(b.id, b);
    return {
      id: b.id,
      name: b.name,
      nameEn: b.nameEn || null,
      image: b.image || null,
      createdAt: b.createdAt ? new Date(b.createdAt) : new Date()
    };
  });

  // 4. Prepare and sanitize products (preserving exact IDs, slugs, and rich fields for SEO)
  const rawProducts = Array.isArray(dbData.product) ? dbData.product : [];
  const sanitizedProducts = rawProducts.map((p) => {
    const validCategoryId = categoryMap.has(p.categoryId) ? p.categoryId : defaultCategory.id;
    const validBrandId = p.brandId && brandMap.has(p.brandId) ? p.brandId : null;

    return {
      id: p.id,
      title: p.title,
      titleEn: p.titleEn || null,
      desc: p.desc || null,
      descEn: p.descEn || null,
      features: p.features || null,
      featuresEn: p.featuresEn || null,
      price: typeof p.price === 'number' ? p.price : parseFloat(p.price) || 0,
      oldPrice: p.oldPrice ? (typeof p.oldPrice === 'number' ? p.oldPrice : parseFloat(p.oldPrice) || null) : null,
      discountType: p.discountType || null,
      discountValue: p.discountValue ? (typeof p.discountValue === 'number' ? p.discountValue : parseFloat(p.discountValue) || null) : null,
      image: p.image || '/placeholder.svg',
      images: p.images || null,
      imageAlt: p.imageAlt || null,
      imageWidth: p.imageWidth ? parseInt(p.imageWidth, 10) : null,
      imageHeight: p.imageHeight ? parseInt(p.imageHeight, 10) : null,
      sizes: p.sizes || null,
      tag: p.tag || null,
      seoKeywords: p.seoKeywords || null,
      seoDesc: p.seoDesc || null,
      categoryId: validCategoryId,
      brandId: validBrandId,
      createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      sizeOptions: p.sizeOptions || null,
      specifications: p.specifications || null,
      keyInfo: p.keyInfo || null,
      certifications: p.certifications || null,
      usage: p.usage || null,
      usageEn: p.usageEn || null,
      ingredients: p.ingredients || null,
      ingredientsEn: p.ingredientsEn || null,
      supplementFacts: p.supplementFacts || null,
      warnings: p.warnings || null,
      warningsEn: p.warningsEn || null,
      disclaimer: p.disclaimer || null,
      disclaimerEn: p.disclaimerEn || null,
      seoKeywordsEn: p.seoKeywordsEn || null,
      seoDescEn: p.seoDescEn || null,
      dosageCalculator: p.dosageCalculator || null,
      faqs: p.faqs || null,
      expiryDate: p.expiryDate || null
    };
  });

  // 5. Prepare users (protect current admin session)
  const rawUsers = Array.isArray(dbData.user) ? dbData.user : [];
  const userEmails = new Set();
  const sanitizedUsers = [];

  for (const u of rawUsers) {
    if (!u.email) continue;
    userEmails.add(u.email.toLowerCase());
    sanitizedUsers.push({
      id: u.id,
      email: u.email.toLowerCase(),
      password: u.password,
      name: u.name || null,
      phone: u.phone || null,
      role: u.role || 'customer',
      cart: u.cart || null,
      resetOtpCode: null,
      resetOtpExpires: null,
      createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
      updatedAt: u.updatedAt ? new Date(u.updatedAt) : new Date()
    });
  }

  // If current active admin is not in the backup, preserve their account
  if (currentAdminUser && currentAdminUser.email && !userEmails.has(currentAdminUser.email.toLowerCase())) {
    const existingAdminInDb = await prisma.user.findUnique({ where: { email: currentAdminUser.email.toLowerCase() } });
    if (existingAdminInDb) {
      sanitizedUsers.push(existingAdminInDb);
    }
  }

  // 6. Execute atomic restore
  await prisma.$transaction(async (tx) => {
    // Delete dependent tables in reverse dependency order
    if (tx.orderItem) await tx.orderItem.deleteMany();
    if (tx.order) await tx.order.deleteMany();
    if (tx.product) await tx.product.deleteMany();
    if (tx.category) await tx.category.deleteMany();
    if (tx.brand) await tx.brand.deleteMany();
    if (tx.offer) await tx.offer.deleteMany();
    if (tx.blog) await tx.blog.deleteMany();
    if (tx.hero) await tx.hero.deleteMany();
    if (tx.medicalTip) await tx.medicalTip.deleteMany();
    if (tx.setting) await tx.setting.deleteMany();
    if (tx.indexingLog) await tx.indexingLog.deleteMany();
    if (tx.whatsAppSession) await tx.whatsAppSession.deleteMany();
    if (tx.pixelEvent) await tx.pixelEvent.deleteMany();
    if (tx.user) await tx.user.deleteMany();

    // Insert Users
    if (sanitizedUsers.length > 0) {
      await tx.user.createMany({ data: sanitizedUsers });
    }

    // Insert Categories
    if (sanitizedCategories.length > 0) {
      await tx.category.createMany({ data: sanitizedCategories });
    }

    // Insert Brands
    if (sanitizedBrands.length > 0) {
      await tx.brand.createMany({ data: sanitizedBrands });
    }

    // Insert Products (maintains exact cuid IDs and all SEO fields)
    if (sanitizedProducts.length > 0) {
      await tx.product.createMany({ data: sanitizedProducts });
    }

    // Insert Offers
    if (Array.isArray(dbData.offer) && dbData.offer.length > 0) {
      const sanitizedOffers = dbData.offer.map((o) => ({
        id: o.id,
        title: o.title,
        discount: o.discount,
        image: o.image,
        productId: o.productId || null,
        createdAt: o.createdAt ? new Date(o.createdAt) : new Date()
      }));
      await tx.offer.createMany({ data: sanitizedOffers });
    }

    // Insert Blogs
    if (Array.isArray(dbData.blog) && dbData.blog.length > 0) {
      const sanitizedBlogs = dbData.blog.map((b) => ({
        id: b.id,
        title: b.title,
        excerpt: b.excerpt,
        content: b.content,
        image: b.image,
        category: b.category,
        readTime: b.readTime,
        date: b.date,
        createdAt: b.createdAt ? new Date(b.createdAt) : new Date()
      }));
      await tx.blog.createMany({ data: sanitizedBlogs });
    }

    // Insert Hero Section
    if (Array.isArray(dbData.hero) && dbData.hero.length > 0) {
      const h = dbData.hero[0];
      await tx.hero.create({
        data: {
          id: h.id || 'hero-section',
          title: h.title || 'العناية تبدأ من هنا',
          subtitle: h.subtitle || 'مجموعة مختارة من أفضل منتجات العناية والشعر',
          image: h.image || 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=700&q=80',
          buttonText: h.buttonText || 'تسوق الآن',
          buttonLink: h.buttonLink || '/products',
          side1Title: h.side1Title || 'الأقسام',
          side1Desc: h.side1Desc || 'تصفح كافة التصنيفات',
          side1Image: h.side1Image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80',
          side1Link: h.side1Link || '/categories',
          side2Title: h.side2Title || 'عروض حصرية',
          side2Desc: h.side2Desc || 'خصومات لفترة محدودة',
          side2Image: h.side2Image || 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&q=80',
          side2Link: h.side2Link || '/offers',
          prod1Id: h.prod1Id || null,
          prod1Image: h.prod1Image || null,
          prod1Type: h.prod1Type || 'product',
          prod2Id: h.prod2Id || null,
          prod2Image: h.prod2Image || null,
          prod2Type: h.prod2Type || 'product',
          prod3Id: h.prod3Id || null,
          prod3Image: h.prod3Image || null,
          prod3Type: h.prod3Type || 'product',
          prod4Id: h.prod4Id || null,
          prod4Image: h.prod4Image || null,
          prod4Type: h.prod4Type || 'product',
          slides: h.slides || null
        }
      });
    } else {
      await tx.hero.create({
        data: { id: 'hero-section' }
      });
    }

    // Insert Medical Tips
    if (Array.isArray(dbData.medicalTip) && dbData.medicalTip.length > 0) {
      const sanitizedTips = dbData.medicalTip.map((m) => ({
        id: m.id,
        title: m.title,
        titleEn: m.titleEn || null,
        content: m.content,
        contentEn: m.contentEn || null,
        image: m.image || null,
        createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        updatedAt: m.updatedAt ? new Date(m.updatedAt) : new Date()
      }));
      await tx.medicalTip.createMany({ data: sanitizedTips });
    }

    // Insert Settings
    if (Array.isArray(dbData.setting) && dbData.setting.length > 0) {
      const sanitizedSettings = dbData.setting.map((s) => ({
        key: s.key,
        value: s.value,
        updatedAt: s.updatedAt ? new Date(s.updatedAt) : new Date()
      }));
      await tx.setting.createMany({ data: sanitizedSettings });
    }

    // Insert Indexing Logs
    if (Array.isArray(dbData.indexingLog) && dbData.indexingLog.length > 0) {
      const sanitizedLogs = dbData.indexingLog.map((l) => ({
        id: l.id,
        url: l.url,
        action: l.action,
        status: l.status,
        response: l.response || null,
        createdAt: l.createdAt ? new Date(l.createdAt) : new Date()
      }));
      await tx.indexingLog.createMany({ data: sanitizedLogs });
    }

    // Insert Orders and OrderItems
    if (Array.isArray(dbData.order) && dbData.order.length > 0) {
      const sanitizedOrders = dbData.order.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        customerEmail: o.customerEmail || null,
        customerPhone: o.customerPhone,
        governorate: o.governorate,
        district: o.district,
        address: o.address,
        building: o.building || null,
        floor: o.floor || null,
        apartment: o.apartment || null,
        notes: o.notes || null,
        paymentMethod: o.paymentMethod || 'cod',
        shippingFee: typeof o.shippingFee === 'number' ? o.shippingFee : 0,
        total: typeof o.total === 'number' ? o.total : parseFloat(o.total) || 0,
        status: o.status || 'pending',
        shippingRef: o.shippingRef || null,
        userId: o.userId && userEmails.has(o.userId) ? o.userId : null,
        createdAt: o.createdAt ? new Date(o.createdAt) : new Date(),
        updatedAt: o.updatedAt ? new Date(o.updatedAt) : new Date()
      }));
      await tx.order.createMany({ data: sanitizedOrders });
    }

    if (Array.isArray(dbData.orderItem) && dbData.orderItem.length > 0) {
      const sanitizedOrderItems = dbData.orderItem.map((oi) => ({
        id: oi.id,
        orderId: oi.orderId,
        productId: oi.productId,
        title: oi.title,
        price: typeof oi.price === 'number' ? oi.price : parseFloat(oi.price) || 0,
        quantity: typeof oi.quantity === 'number' ? oi.quantity : parseInt(oi.quantity, 10) || 1,
        image: oi.image || null
      }));
      await tx.orderItem.createMany({ data: sanitizedOrderItems });
    }

    // Insert WhatsApp Sessions
    if (Array.isArray(dbData.whatsAppSession) && dbData.whatsAppSession.length > 0) {
      const sanitizedSessions = dbData.whatsAppSession.map((s) => ({
        key: s.key,
        value: s.value,
        updatedAt: s.updatedAt ? new Date(s.updatedAt) : new Date()
      }));
      await tx.whatsAppSession.createMany({ data: sanitizedSessions });
    }

    // Insert Pixel Events
    if (Array.isArray(dbData.pixelEvent) && dbData.pixelEvent.length > 0) {
      const sanitizedPixelEvents = dbData.pixelEvent.map((pe) => ({
        id: pe.id,
        eventName: pe.eventName,
        url: pe.url || null,
        metadata: pe.metadata || null,
        eventId: pe.eventId || null,
        fbp: pe.fbp || null,
        fbc: pe.fbc || null,
        customerIp: pe.customerIp || null,
        userAgent: pe.userAgent || null,
        userId: pe.userId || null,
        createdAt: pe.createdAt ? new Date(pe.createdAt) : new Date()
      }));
      await tx.pixelEvent.createMany({ data: sanitizedPixelEvents });
    }
  });

  // Re-sync WhatsApp authentication files to disk if session data was restored
  const authFolder = process.env.WHATSAPP_AUTH_PATH || path.join(__dirname, '..', '..', '.baileys_auth');
  if (Array.isArray(dbData.whatsAppSession) && dbData.whatsAppSession.length > 0) {
    if (!fs.existsSync(authFolder)) {
      fs.mkdirSync(authFolder, { recursive: true });
    }
    for (const row of dbData.whatsAppSession) {
      if (row.key && row.value) {
        try {
          fs.writeFileSync(path.join(authFolder, row.key), row.value, 'utf-8');
        } catch (e) {}
      }
    }
  }

  return {
    productsRestored: sanitizedProducts.length,
    categoriesRestored: sanitizedCategories.length,
    brandsRestored: sanitizedBrands.length,
    indexingLogsRestored: Array.isArray(dbData.indexingLog) ? dbData.indexingLog.length : 0,
    settingsRestored: Array.isArray(dbData.setting) ? dbData.setting.length : 0,
    ordersRestored: Array.isArray(dbData.order) ? dbData.order.length : 0,
    whatsAppSessionsRestored: Array.isArray(dbData.whatsAppSession) ? dbData.whatsAppSession.length : 0,
    pixelEventsRestored: Array.isArray(dbData.pixelEvent) ? dbData.pixelEvent.length : 0,
    imagesExtracted: extractedCount
  };
}

module.exports = {
  generateFullStoreBackup,
  restoreFullStoreBackup
};
