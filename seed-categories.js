const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const categories = [
    'مكملات الأوميجا', 'البشرة والشعر', 'فيتامينات ومعادن', 'مسكنات', 
    'الصحة الجنسية', 'الصحة العامة', 'مكملات عشبية', 'التخسيس واللياقة', 
    'صحة الطفل', 'الحمل والرضاعة', 'فيتامينات متعددة', 'عظام ومفاصل', 'أحماض أمينية'
  ]

  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name }
    })
  }

  console.log('Categories seeded successfully! ✅')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
