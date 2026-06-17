process.env.DATABASE_URL = "postgresql://mithaly:mithaly_password@localhost:5432/mithaly?schema=public";
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.product.count();
  console.log('Total products:', count);
  const products = await prisma.product.findMany({
    select: { id: true, title: true, price: true }
  });
  console.log('Products:', JSON.stringify(products, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
