const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const id = 'cmonk6lob0001whrw024rgd0x'
  try {
    await prisma.product.delete({ where: { id } })
    console.log(`Product ${id} deleted successfully! ✅`)
  } catch (err) {
    console.log(`Product ${id} not found or already deleted.`)
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
