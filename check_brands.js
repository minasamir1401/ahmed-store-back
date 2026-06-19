process.env.DATABASE_URL = "postgresql://mithaly:mithaly_password@localhost:5432/mithaly?schema=public";
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const brands = await prisma.brand.findMany();
  console.log('Total brands:', brands.length);
  console.log('Brands details:');
  brands.forEach(b => {
    console.log(`- ID: ${b.id}, Name: "${b.name}", NameEn: "${b.nameEn}", Image: "${b.image}"`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
