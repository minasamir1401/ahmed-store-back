const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearProducts() {
  try {
    const initialCount = await prisma.product.count();
    console.log(`Current products count: ${initialCount}`);

    const deleteResult = await prisma.product.deleteMany({});
    console.log(`Deleted ${deleteResult.count} products.`);

    const updatedCategories = await prisma.category.updateMany({
      data: { count: 0 }
    });
    console.log(`Reset count for ${updatedCategories.count} categories to 0.`);

    await prisma.hero.updateMany({
      data: {
        prod1Id: null,
        prod2Id: null,
        prod3Id: null,
        prod4Id: null
      }
    });
    console.log('Cleared hero product links.');

    await prisma.offer.updateMany({
      data: {
        productId: null
      }
    });
    console.log('Cleared offer product links.');

    const finalCount = await prisma.product.count();
    console.log(`Final products count: ${finalCount}`);
  } catch (error) {
    console.error('Error clearing products:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearProducts();
