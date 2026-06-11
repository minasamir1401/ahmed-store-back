const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding data...');

  // Create Categories
  const skinCare = await prisma.category.upsert({
    where: { name: 'العناية بالبشرة' },
    update: {},
    create: {
      name: 'العناية بالبشرة',
      count: 220,
      image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=300&q=80',
      href: '/categories/beauty'
    },
  });

  const vitamins = await prisma.category.upsert({
    where: { name: 'فيتامينات ومعادن' },
    update: {},
    create: {
      name: 'فيتامينات ومعادن',
      count: 340,
      image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80',
      href: '/categories/vitamins'
    },
  });

  // Create Products
  await prisma.product.createMany({
    data: [
      {
        title: 'تونر الشاي الأخضر',
        desc: 'ينعش ويرطب البشرة',
        price: 95,
        image: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&q=80',
        categoryId: skinCare.id
      },
      {
        title: 'فيتامين D3',
        desc: 'يدعم صحة العظام والمناعة',
        price: 110,
        image: 'https://images.unsplash.com/photo-1550572017-edd951b55104?w=400&q=80',
        categoryId: vitamins.id
      }
    ]
  });

  // Create Blog Posts
  await prisma.blog.create({
    data: {
      title: 'دليل العناية بالبشرة الحساسة',
      excerpt: 'خطوات بسيطة لبشرة صحية وجميلة',
      content: 'محتوى المقال الكامل هنا...',
      image: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=600&q=80',
      category: 'العناية بالبشرة',
      readTime: '5 دقائق',
      date: '5 مايو 2024'
    }
  });

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
