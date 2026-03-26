import { PrismaClient, Prisma } from "@prisma/client";
import {
  ENCRYPTED_FIELDS,
  encryptObject,
  decryptObject,
} from "./encryption.server";

declare global {
  // eslint-disable-next-line no-var
  var __prismaBase: PrismaClient;
}

// ── Encryption extension (Prisma 6 — replaces deprecated $use) ──────
// Intercepts every query via $allOperations, encrypts data fields
// before writes and decrypts them after reads.  Models not listed in
// ENCRYPTED_FIELDS (e.g. Session) pass through untouched.

const encryptionExtension = Prisma.defineExtension({
  name: "field-encryption",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const fields = model ? ENCRYPTED_FIELDS[model] : null;
        if (!fields) return query(args);

        // ── Encrypt before write ────────────────────────────────
        const writeOps = ["create", "update", "createMany", "updateMany"];
        if (writeOps.includes(operation)) {
          if (operation === "createMany" && Array.isArray((args as any).data)) {
            (args as any).data.forEach((item: any) => encryptObject(item, fields));
          } else if ((args as any).data) {
            encryptObject((args as any).data, fields);
          }
        }
        if (operation === "upsert") {
          encryptObject((args as any).create, fields);
          encryptObject((args as any).update, fields);
        }

        const result = await query(args);

        // ── Decrypt after read ──────────────────────────────────
        if (result) {
          if (Array.isArray(result)) {
            result.forEach((item: any) => decryptObject(item, fields));
          } else if (typeof result === "object") {
            decryptObject(result as any, fields);
          }
        }

        return result;
      },
    },
  },
});

// ── Client creation ─────────────────────────────────────────────────

function createBaseClient(): PrismaClient {
  const client = new PrismaClient();
  client.$executeRawUnsafe("PRAGMA journal_mode = WAL;").catch(() => {});
  client.$executeRawUnsafe("PRAGMA busy_timeout = 5000;").catch(() => {});
  return client;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.__prismaBase) {
    global.__prismaBase = createBaseClient();
  }
}

// Base client — used by PrismaSessionStorage (Shopify manages Session model)
export const prismaBase = global.__prismaBase ?? createBaseClient();

// Extended client — used by all app code (auto-encrypts/decrypts)
const prisma = prismaBase.$extends(encryptionExtension) as unknown as PrismaClient;

export default prisma;
