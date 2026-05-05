const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('Importing articles...');
  
  const articlesPath = path.join(__dirname, '..', 'mithaly-app', 'articles.json');
  const articlesData = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));

  for (const article of articlesData) {
    await prisma.blog.create({
      data: {
        title: article.title,
        excerpt: article.excerpt,
        content: article.content,
        image: article.image,
        category: article.category,
        readTime: article.readTime,
        date: article.date,
      },
    });
    console.log(`Imported: ${article.title}`);
  }

  console.log('Import finished successfully! 🚀');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
