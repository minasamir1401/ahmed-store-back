process.env.DATABASE_URL = "postgresql://mithaly:mithaly_password@localhost:5432/mithaly?schema=public";
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: 'كود' } },
        { title: { contains: 'ليفر' } },
        { title: { contains: 'Cod' } },
        { titleEn: { contains: 'Cod' } }
      ]
    },
    include: { brand: true, category: true }
  });
  console.log('Matches:', JSON.stringify(products, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
