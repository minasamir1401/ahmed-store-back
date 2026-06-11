const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Dropping ImageStore table due to column type incompatibility (Base64 string to BYTEA)...');
  try {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "ImageStore" CASCADE;');
    console.log('Successfully dropped ImageStore table. ✅');
  } catch (e) {
    console.error('Failed to drop ImageStore table:', e);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
