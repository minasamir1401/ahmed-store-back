const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const cats = await prisma.category.findMany()
  console.log(JSON.stringify(cats, null, 2))
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
