const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const db = await prisma.$queryRawUnsafe('SELECT current_database(), current_schema();');
  console.log('Database and schema:', db);
  const count = await prisma.product.count();
  console.log('Prisma product count:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());

