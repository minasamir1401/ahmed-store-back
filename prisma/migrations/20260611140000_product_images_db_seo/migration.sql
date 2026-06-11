-- Align existing PostgreSQL schema with the current Prisma models and DB-backed images.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "descEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "featuresEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "usageEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ingredientsEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warningsEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "disclaimerEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoKeywordsEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoDescEn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "faqs" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageAlt" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageWidth" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageHeight" INTEGER;

ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod1Id" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod1Image" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod1Type" TEXT DEFAULT 'product';
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod2Id" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod2Image" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod2Type" TEXT DEFAULT 'product';
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod3Id" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod3Image" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod3Type" TEXT DEFAULT 'product';
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod4Id" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod4Image" TEXT;
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "prod4Type" TEXT DEFAULT 'product';
ALTER TABLE "Hero" ADD COLUMN IF NOT EXISTS "slides" TEXT;

CREATE TABLE IF NOT EXISTS "ImageStore" (
    "id" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumbnailData" BYTEA,
    "fileName" TEXT,
    "altText" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageStore_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "thumbnailData" BYTEA;
ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "altText" TEXT;
ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "width" INTEGER;
ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "height" INTEGER;
ALTER TABLE "ImageStore" ADD COLUMN IF NOT EXISTS "size" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ImageStore'
      AND column_name = 'data'
      AND data_type <> 'bytea'
  ) THEN
    ALTER TABLE "ImageStore" ALTER COLUMN "data" TYPE BYTEA USING decode("data", 'base64');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ImageStore_createdAt_idx" ON "ImageStore"("createdAt");

CREATE TABLE IF NOT EXISTS "MedicalTip" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalTip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "User_phone_idx" ON "User"("phone");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_role_email_idx" ON "User"("role", "email");
CREATE INDEX IF NOT EXISTS "Product_createdAt_idx" ON "Product"("createdAt");
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_brandId_idx" ON "Product"("brandId");
CREATE INDEX IF NOT EXISTS "Product_categoryId_createdAt_idx" ON "Product"("categoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_brandId_createdAt_idx" ON "Product"("brandId", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_price_idx" ON "Product"("price");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");
CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_customerPhone_idx" ON "Order"("customerPhone");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
