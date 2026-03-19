import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

function createClient(): PrismaClient {
  const client = new PrismaClient();
  // Enable WAL mode so reads are never blocked by concurrent writes
  // (critical: WhatsApp history sync writes must not block route loaders)
  client.$executeRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});
  client.$executeRawUnsafe('PRAGMA busy_timeout = 5000;').catch(() => {});
  return client;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
}

const prisma = global.prismaGlobal ?? createClient();

export default prisma;
