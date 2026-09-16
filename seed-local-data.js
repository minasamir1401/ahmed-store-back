const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding local database with fresh custom data...');

  // 1. Admin User
  const adminPassword = await bcrypt.hash('admin123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@mithaly.com' },
    update: {
      password: adminPassword,
      role: 'admin',
      name: 'المدير العام',
      phone: '01000000000'
    },
    create: {
      email: 'admin@mithaly.com',
      password: adminPassword,
      role: 'admin',
      name: 'المدير العام',
      phone: '01000000000'
    }
  });
  console.log('Admin user ready:', admin.email);

  // Sample Customer User
  const customerPassword = await bcrypt.hash('customer123', 12);
  await prisma.user.upsert({
    where: { email: 'customer@mithaly.com' },
    update: {
      password: customerPassword,
      role: 'customer',
      name: 'عميل تجريبي',
      phone: '01200000000'
    },
    create: {
      email: 'customer@mithaly.com',
      password: customerPassword,
      role: 'customer',
      name: 'عميل تجريبي',
      phone: '01200000000'
    }
  });

  // 2. Categories
  const categoryDefinitions = [
    {
      name: 'فيتامينات ومعادن',
      nameEn: 'Vitamins & Minerals',
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
      href: '/categories/vitamins'
    },
    {
      name: 'مكملات الأوميجا',
      nameEn: 'Omega Supplements',
      image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&q=80',
      href: '/categories/omega'
    },
    {
      name: 'البشرة والشعر',
      nameEn: 'Skin & Hair',
      image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=500&q=80',
      href: '/categories/beauty'
    },
    {
      name: 'عظام ومفاصل',
      nameEn: 'Bones & Joints',
      image: 'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=500&q=80',
      href: '/categories/bones'
    },
    {
      name: 'الصحة العامة',
      nameEn: 'General Health',
      image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=500&q=80',
      href: '/categories/health'
    },
    {
      name: 'مكملات عشبية',
      nameEn: 'Herbal Supplements',
      image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&q=80',
      href: '/categories/herbal'
    },
    {
      name: 'التخسيس واللياقة',
      nameEn: 'Fitness & Weight Loss',
      image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=500&q=80',
      href: '/categories/fitness'
    },
    {
      name: 'فيتامينات متعددة',
      nameEn: 'Multivitamins',
      image: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&q=80',
      href: '/categories/multivitamins'
    },
    {
      name: 'أحماض أمينية',
      nameEn: 'Amino Acids',
      image: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=500&q=80',
      href: '/categories/amino'
    }
  ];

  const categoriesMap = {};
  for (const cat of categoryDefinitions) {
    const record = await prisma.category.upsert({
      where: { name: cat.name },
      update: {
        nameEn: cat.nameEn,
        image: cat.image,
        href: cat.href
      },
      create: {
        name: cat.name,
        nameEn: cat.nameEn,
        image: cat.image,
        href: cat.href,
        count: 0
      }
    });
    categoriesMap[cat.name] = record;
  }
  console.log(`Seeded ${Object.keys(categoriesMap).length} categories.`);

  // 3. Brands
  const brandDefinitions = [
    { name: 'Now Foods', nameEn: 'Now Foods', image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80' },
    { name: 'Swanson', nameEn: 'Swanson', image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=300&q=80' },
    { name: 'Solaray', nameEn: 'Solaray', image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=300&q=80' },
    { name: 'California Gold Nutrition', nameEn: 'California Gold Nutrition', image: 'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=300&q=80' },
    { name: "Doctor's Best", nameEn: "Doctor's Best", image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=300&q=80' },
    { name: 'Solgar', nameEn: 'Solgar', image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=300&q=80' },
    { name: "Nature's Way", nameEn: "Nature's Way", image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300&q=80' },
    { name: 'Nutricost', nameEn: 'Nutricost', image: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=300&q=80' },
    { name: 'Himalaya', nameEn: 'Himalaya', image: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=300&q=80' },
    { name: '21st Century', nameEn: '21st Century', image: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=300&q=80' }
  ];

  const brandsMap = {};
  for (const b of brandDefinitions) {
    const record = await prisma.brand.upsert({
      where: { name: b.name },
      update: {
        nameEn: b.nameEn,
        image: b.image
      },
      create: {
        name: b.name,
        nameEn: b.nameEn,
        image: b.image
      }
    });
    brandsMap[b.name] = record;
  }
  console.log(`Seeded ${Object.keys(brandsMap).length} brands.`);

  // 4. Products
  const productsData = [
    {
      title: 'ناو فودز أوميجا 3 زيت سمك نقي 1000 مجم 180 كبسولة',
      titleEn: 'Now Foods Omega-3 Fish Oil 1000 mg 180 Softgels',
      desc: 'زيت سمك نقي غني بأحماض EPA و DHA لدعم صحة القلب والمخ والشرايين.',
      descEn: 'Purified fish oil molecularly distilled with EPA and DHA to support cardiovascular and cognitive health.',
      price: 1850,
      oldPrice: 2100,
      image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=600&q=80',
      tag: 'الأكثر مبيعاً',
      category: 'مكملات الأوميجا',
      brand: 'Now Foods',
      sizes: '180 كبسولة',
      features: 'خالٍ من الكوليسترول\nتقطير جزيئي معتمد\nدعم صحة القلب والدماغ',
      usage: 'كبسولتان يومياً مع الطعام.',
      warnings: 'استشر طبيبك في حال الحمل أو الرضاعة أو تناول أدوية سيولة.',
      specifications: JSON.stringify([
        { label: 'الجرعة اليومية', value: 'كبسولتان' },
        { label: 'EPA', value: '360 مجم' },
        { label: 'DHA', value: '240 مجم' },
        { label: 'بلد المنشأ', value: 'الولايات المتحدة الأمريكية' }
      ]),
      sizeOptions: JSON.stringify([
        { size: '100 كبسولة', price: 1250, originalPrice: 1400 },
        { size: '180 كبسولة', price: 1850, originalPrice: 2100 }
      ])
    },
    {
      title: 'كاليفورنيا جولد كولاجين أب ببتيدات بحرية مع فيتامين سي 206 جم',
      titleEn: 'California Gold Nutrition CollagenUP Marine Peptides 206g',
      desc: 'ببتيدات كولاجين بحري متحلل مع حمض الهيالورونيك وفيتامين سي لنضارة البشرة وصحة الشعر والمفاصل.',
      descEn: 'Marine sourced collagen peptides with hyaluronic acid and vitamin C for radiant skin and joint mobility.',
      price: 2500,
      oldPrice: 2900,
      image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=600&q=80',
      tag: 'عرض خاص',
      category: 'البشرة والشعر',
      brand: 'California Gold Nutrition',
      sizes: '206 جرام',
      features: 'بدون نكهة مضافة\nسريع الذوبان\nدعم مرونة البشرة والأظافر',
      usage: 'مكيال واحد يومياً مذاب في ماء أو عصير بدرجة حرارة الغرفة.',
      specifications: JSON.stringify([
        { label: 'الوزن الصافي', value: '206 جرام' },
        { label: 'المصدر', value: 'كولاجين سمكي متحلل' },
        { label: 'فيتامين C', value: '90 مجم' }
      ])
    },
    {
      title: 'سولاراي كالسيوم ومغنيسيوم وزنك 250 كبسولة نباتية',
      titleEn: 'Solaray Calcium Magnesium Zinc 250 VegCaps',
      desc: 'تركيبة متوازنة ومخلبية لامتصاص فائق لدعم كثافة العظام واسترخاء العضلات وصحة المناعة.',
      descEn: 'Chelated mineral complex designed for optimal bio-availability supporting bone structure and nerve function.',
      price: 3500,
      oldPrice: 3950,
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&q=80',
      tag: 'مميز',
      category: 'عظام ومفاصل',
      brand: 'Solaray',
      sizes: '250 كبسولة',
      features: 'معادن مخلبية سهلة الامتصاص\nكبسولات نباتية 100%\nدعم العظام والأسنان',
      usage: '3 كبسولات يومياً مع وجبة الطعام أو كوب ماء.',
      specifications: JSON.stringify([
        { label: 'كالسيوم', value: '1000 مجم' },
        { label: 'مغنيسيوم', value: '500 مجم' },
        { label: 'زنك', value: '25 مجم' }
      ])
    },
    {
      title: 'سوانسون بربرين 400 مجم 60 كبسولة',
      titleEn: 'Swanson Berberine 400 mg 60 Capsules',
      desc: 'مستخلص بربرين نقي لدعم مستويات السكر في الدم وصحة التمثيل الغذائي والأيض.',
      descEn: 'Natural berberine extract to support balanced glucose metabolism and healthy lipid profiles.',
      price: 2250,
      oldPrice: 2600,
      image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&q=80',
      tag: 'جديد',
      category: 'مكملات عشبية',
      brand: 'Swanson',
      sizes: '60 كبسولة',
      features: 'نقي وعالي التركيز\nتحفيز إنزيم AMPK\nدعم صحة القلب والشرايين',
      usage: 'كبسولة واحدة مرتين إلى ثلاث مرات يومياً مع الوجبات.',
      specifications: JSON.stringify([
        { label: 'تركيز الكبسولة', value: '400 مجم' },
        { label: 'المادة الفعالة', value: 'بربرين هيدروكلوريد' }
      ])
    },
    {
      title: 'دكتورز بيست جلوكوزامين كوندرويتين MSM عدد 120 كبسولة',
      titleEn: "Doctor's Best Glucosamine Chondroitin MSM 120 Veggie Caps",
      desc: 'تركيبة ثلاثية متكاملة لدعم مرونة المفاصل وتجديد الغضاريف والحد من الاحتكاك.',
      descEn: 'Comprehensive joint support formula featuring OptiMSM to facilitate cartilage health and comfort.',
      price: 2250,
      oldPrice: 2500,
      image: 'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=600&q=80',
      tag: 'الأكثر طلباً',
      category: 'عظام ومفاصل',
      brand: "Doctor's Best",
      sizes: '120 كبسولة',
      features: 'يحتوي على OptiMSM النقي\nدعم مرونة حركة المفاصل\nتغذية الأنسجة الضامة',
      usage: '4 كبسولات يومياً مع الطعام.',
      specifications: JSON.stringify([
        { label: 'جلوكوزامين', value: '1500 مجم' },
        { label: 'كوندرويتين', value: '1200 مجم' },
        { label: 'MSM', value: '1000 مجم' }
      ])
    },
    {
      title: 'سولجار فيتامين ب-مركب ب-50 عدد 100 قرص نباتي',
      titleEn: 'Solgar Vitamin B-Complex B-50 100 Veggie Caps',
      desc: 'مجموعة كاملة من فيتامينات ب لدعم إنتاج الطاقة والحد من الإجهاد وصحة الجهاز العصبي.',
      descEn: 'Balanced high-potency Vitamin B complex to bolster energy release and cognitive vigor.',
      price: 1950,
      oldPrice: 2200,
      image: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=600&q=80',
      tag: '',
      category: 'فيتامينات متعددة',
      brand: 'Solgar',
      sizes: '100 قرص',
      features: 'طاقة ونشاط يومي\nدعم الأعصاب والمزاج\nنباتي وخالٍ من الغلوتين',
      usage: 'قرص واحد يومياً ويفضل مع وجبة الإفطار.',
      specifications: JSON.stringify([
        { label: 'B1, B2, B3, B6', value: '50 مجم لكل منها' },
        { label: 'B12', value: '50 ميكروجرام' },
        { label: 'حمض الفوليك', value: '400 ميكروجرام' }
      ])
    },
    {
      title: 'نيتشرز واي كلوروفيل سائل بنكهة النعناع 473 مل',
      titleEn: "Nature's Way Liquid Chlorophyll Mint 473 ml",
      desc: 'مشروب الكلوروفيل المركز والمستخلص من أوراق نبات التوت الأبيض لتنقية الجسم ودعم الهضم.',
      descEn: 'Premium water-soluble chlorophyllin complex providing cellular antioxidant protection and digestive clarity.',
      price: 2350,
      oldPrice: 2700,
      image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=600&q=80',
      tag: 'شائع',
      category: 'الصحة العامة',
      brand: "Nature's Way",
      sizes: '473 مل',
      features: 'ديتوكس طبيعي للجسم\nنكهة نعناع منعشة\n100 مجم كلوروفيل لكل ملعقة',
      usage: 'ملعقة كبيرة (15 مل) يومياً في كوب ماء أو عصير.',
      specifications: JSON.stringify([
        { label: 'الحجم', value: '473 مل' },
        { label: 'التركيز', value: '100 مجم لكل جرعة' },
        { label: 'النكهة', value: 'نعناع طبيعي' }
      ])
    },
    {
      title: '21st سنشري بيوتين 10,000 ميكروجرام 120 قرص',
      titleEn: '21st Century Biotin 10,000 mcg 120 Tablets',
      desc: 'تركيبة عالية التركيز من البيوتين لتحفيز نمو الشعر وتقوية الأظافر ونضارة البشرة.',
      descEn: 'Maximum strength biotin supplement designed to fortify hair thickness and nail resilience.',
      price: 1300,
      oldPrice: 1550,
      image: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=600&q=80',
      tag: 'سعر منافس',
      category: 'البشرة والشعر',
      brand: '21st Century',
      sizes: '120 قرص',
      features: 'أقصى تركيز 10,000 ميكروجرام\nيقوي بصيلات الشعر ويمنع التساقط\nيعزز صحة الأظافر الضعيفة',
      usage: 'قرص واحد يومياً مع الطعام.',
      specifications: JSON.stringify([
        { label: 'البيوتين', value: '10,000 ميكروجرام' },
        { label: 'العدد', value: '120 قرص' }
      ])
    }
  ];

  const createdProducts = [];
  for (const item of productsData) {
    const category = categoriesMap[item.category];
    const brand = brandsMap[item.brand];
    if (!category) continue;

    // Check if product with title exists
    const existing = await prisma.product.findFirst({
      where: { title: item.title }
    });

    let product;
    if (existing) {
      product = await prisma.product.update({
        where: { id: existing.id },
        data: {
          titleEn: item.titleEn,
          desc: item.desc,
          descEn: item.descEn,
          price: item.price,
          oldPrice: item.oldPrice,
          image: item.image,
          tag: item.tag,
          sizes: item.sizes,
          features: item.features,
          usage: item.usage,
          warnings: item.warnings,
          specifications: item.specifications,
          sizeOptions: item.sizeOptions,
          categoryId: category.id,
          brandId: brand ? brand.id : null
        }
      });
    } else {
      product = await prisma.product.create({
        data: {
          title: item.title,
          titleEn: item.titleEn,
          desc: item.desc,
          descEn: item.descEn,
          price: item.price,
          oldPrice: item.oldPrice,
          image: item.image,
          tag: item.tag,
          sizes: item.sizes,
          features: item.features,
          usage: item.usage,
          warnings: item.warnings,
          specifications: item.specifications,
          sizeOptions: item.sizeOptions,
          categoryId: category.id,
          brandId: brand ? brand.id : null
        }
      });
    }
    createdProducts.push(product);
  }
  console.log(`Seeded ${createdProducts.length} products.`);

  // Update Category counts
  for (const cat of Object.values(categoriesMap)) {
    const count = await prisma.product.count({ where: { categoryId: cat.id } });
    await prisma.category.update({
      where: { id: cat.id },
      data: { count }
    });
  }

  // 5. Hero Section
  const p1 = createdProducts[0];
  const p2 = createdProducts[1];
  const p3 = createdProducts[2];
  const p4 = createdProducts[3];

  await prisma.hero.upsert({
    where: { id: 'hero-section' },
    update: {
      title: 'الصحة والجمال تبدأ من هنا',
      subtitle: 'أفضل الفيتامينات والمكملات الغذائية الأصلية 100% بأفضل الأسعار المحلية',
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=900&q=80',
      buttonText: 'تسوق الآن',
      buttonLink: '/categories',
      side1Title: 'الأقسام',
      side1Desc: 'تصفح جميع التصنيفات والمكملات',
      side1Image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=500&q=80',
      side1Link: '/categories',
      side2Title: 'عروض حصرية',
      side2Desc: 'خصومات مميزة لفترة محدودة',
      side2Image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&q=80',
      side2Link: '/offers',
      prod1Id: p1 ? p1.id : null,
      prod1Image: p1 ? p1.image : null,
      prod2Id: p2 ? p2.id : null,
      prod2Image: p2 ? p2.image : null,
      prod3Id: p3 ? p3.id : null,
      prod3Image: p3 ? p3.image : null,
      prod4Id: p4 ? p4.id : null,
      prod4Image: p4 ? p4.image : null
    },
    create: {
      id: 'hero-section',
      title: 'الصحة والجمال تبدأ من هنا',
      subtitle: 'أفضل الفيتامينات والمكملات الغذائية الأصلية 100% بأفضل الأسعار المحلية',
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=900&q=80',
      buttonText: 'تسوق الآن',
      buttonLink: '/categories',
      side1Title: 'الأقسام',
      side1Desc: 'تصفح جميع التصنيفات والمكملات',
      side1Image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=500&q=80',
      side1Link: '/categories',
      side2Title: 'عروض حصرية',
      side2Desc: 'خصومات مميزة لفترة محدودة',
      side2Image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&q=80',
      side2Link: '/offers',
      prod1Id: p1 ? p1.id : null,
      prod1Image: p1 ? p1.image : null,
      prod2Id: p2 ? p2.id : null,
      prod2Image: p2 ? p2.image : null,
      prod3Id: p3 ? p3.id : null,
      prod3Image: p3 ? p3.image : null,
      prod4Id: p4 ? p4.id : null,
      prod4Image: p4 ? p4.image : null
    }
  });
  console.log('Hero section seeded.');

  // 6. Medical Tips
  const tips = [
    {
      title: 'أفضل توقيت لتناول فيتامين د والمغنيسيوم',
      titleEn: 'Best Time to Take Vitamin D and Magnesium',
      content: 'يُفضل تناول فيتامين د صباحاً أو ظهراً مع وجبة تحتوي على دهون صحية لزيادة الامتصاص، بينما يُفضل تناول المغنيسيوم مساءً للمساعدة على استرخاء العضلات والنوم العميق.',
      contentEn: 'Vitamin D is best taken with a meal containing healthy fats during the day, while magnesium is optimal in the evening to promote muscle relaxation and deep sleep.',
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&q=80'
    },
    {
      title: 'أهمية أوميجا 3 لصحة القلب والتركيز',
      titleEn: 'Benefits of Omega-3 for Heart and Cognitive Health',
      content: 'أحماض EPA و DHA تلعب دوراً محورياً في خفض الدهون الثلاثية ودعم وظائف الذاكرة وتقليل الالتهابات المزمنة في الجسم.',
      contentEn: 'EPA and DHA essential fatty acids are instrumental in reducing triglyceride levels and sustaining focus and memory.',
      image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=600&q=80'
    }
  ];

  for (const tip of tips) {
    const existingTip = await prisma.medicalTip.findFirst({ where: { title: tip.title } });
    if (!existingTip) {
      await prisma.medicalTip.create({ data: tip });
    }
  }
  console.log('Medical tips seeded.');

  // 7. Offers
  if (p1) {
    const existingOffer = await prisma.offer.findFirst({ where: { title: 'خصم خاص على مكملات أوميجا' } });
    if (!existingOffer) {
      await prisma.offer.create({
        data: {
          title: 'خصم خاص على مكملات أوميجا',
          discount: '15% خصم',
          image: p1.image,
          productId: p1.id
        }
      });
    }
  }

  // 8. Blog Posts
  const existingBlog = await prisma.blog.findFirst({ where: { title: 'دليلك الشامل لاختيار المكملات المناسبة' } });
  if (!existingBlog) {
    await prisma.blog.create({
      data: {
        title: 'دليلك الشامل لاختيار المكملات المناسبة',
        excerpt: 'كيف تختار الفيتامين الأنسب لاحتياجات جسمك وروتينك اليومي بأمان.',
        content: 'تعتبر المكملات الغذائية داعماً أساسياً للصحة العامة عند استخدامها بوعي. تأكد دائماً من قراءة بطاقة الحقائق الغذائية واستشارة المختصين قبل البدء بأي روتين جديد.',
        image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=600&q=80',
        category: 'الصحة العامة',
        readTime: '4 دقائق',
        date: '16 سبتمبر 2026'
      }
    });
  }

  console.log('Local database populated successfully! All records ready.');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
