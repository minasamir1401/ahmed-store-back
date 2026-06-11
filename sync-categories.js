const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const categories = [
  { name: "مكملات الأوميجا", count: 85 },
  { name: "البشرة والشعر", count: 220 },
  { name: "فيتامينات ومعادن", count: 340 },
  { name: "مسكنات", count: 95 },
  { name: "الصحة الجنسية", count: 110 },
  { name: "الصحة العامة", count: 180 },
  { name: "مكملات عشبية", count: 65 },
  { name: "التخسيس واللياقة", count: 130 },
  { name: "صحة الطفل", count: 90 },
  { name: "الحمل والرضاعة", count: 75 },
  { name: "فيتامينات متعددة", count: 210 },
  { name: "عظام ومفاصل", count: 140 },
  { name: "أحماض أمينية", count: 120 }
]

async function main() {
  console.log('Resetting categories...')
  
  // Keep products but disconnect categories if needed
  // Or just update existing ones and add new ones
  
  // 1. Delete all existing categories (Warning: this might affect products)
  // To be safe, we'll try to find by name or create
  
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: { count: cat.count },
      create: { 
        name: cat.name, 
        count: cat.count,
        image: `https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=400&q=80` // Default medical image
      }
    })
  }
  
  console.log('Categories updated successfully! ✅')
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
