-- CreateTable
CREATE TABLE "WhatsAppAuthKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppAuthKey_shop_fkey" FOREIGN KEY ("shop") REFERENCES "WhatsAppSession" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppChat_shop_fkey" FOREIGN KEY ("shop") REFERENCES "WhatsAppSession" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "notify" TEXT,
    "metadata" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppContact_shop_fkey" FOREIGN KEY ("shop") REFERENCES "WhatsAppSession" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WhatsAppAuthKey_shop_keyType_idx" ON "WhatsAppAuthKey"("shop", "keyType");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAuthKey_shop_keyType_keyId_key" ON "WhatsAppAuthKey"("shop", "keyType", "keyId");

-- CreateIndex
CREATE INDEX "WhatsAppChat_shop_idx" ON "WhatsAppChat"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppChat_shop_jid_key" ON "WhatsAppChat"("shop", "jid");

-- CreateIndex
CREATE INDEX "WhatsAppContact_shop_idx" ON "WhatsAppContact"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_shop_jid_key" ON "WhatsAppContact"("shop", "jid");
