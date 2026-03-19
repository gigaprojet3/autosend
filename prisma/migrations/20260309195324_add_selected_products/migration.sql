-- CreateTable
CREATE TABLE "SelectedProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SelectedProduct_shop_idx" ON "SelectedProduct"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SelectedProduct_shop_productId_key" ON "SelectedProduct"("shop", "productId");
