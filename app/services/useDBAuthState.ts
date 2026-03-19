import { proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import db from '../db.server';

/**
 * Custom auth state provider that stores Baileys credentials and signal keys
 * in the database (SQLite/PostgreSQL via Prisma) instead of the file system.
 *
 * Replaces `useMultiFileAuthState` for production-grade persistence.
 */
export async function useDBAuthState(shop: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // -----------------------------------------------------------------------
  // Load or initialize credentials
  // -----------------------------------------------------------------------
  const session = await db.whatsAppSession.findUnique({ where: { shop } });

  let creds: AuthenticationCreds;
  if (session?.creds) {
    try {
      creds = JSON.parse(session.creds, BufferJSON.reviver);
    } catch {
      console.warn(`⚠️ Could not parse stored creds for ${shop}, reinitializing`);
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  // -----------------------------------------------------------------------
  // Save credentials to DB
  // -----------------------------------------------------------------------
  const saveCreds = async () => {
    const serialized = JSON.stringify(creds, BufferJSON.replacer);
    await db.whatsAppSession.upsert({
      where: { shop },
      create: { shop, creds: serialized },
      update: { creds: serialized, updatedAt: new Date() },
    });
  };

  // -----------------------------------------------------------------------
  // Signal key read / write helpers
  // -----------------------------------------------------------------------
  const readKey = async (type: string, id: string): Promise<any> => {
    const row = await db.whatsAppAuthKey.findUnique({
      where: { shop_keyType_keyId: { shop, keyType: type, keyId: id } },
    });
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value, BufferJSON.reviver);
      // proto buffer types need to be deserialized
      if (type === 'app-state-sync-key' && parsed) {
        return proto.Message.AppStateSyncKeyData.fromObject(parsed);
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const writeKey = async (type: string, id: string, value: any) => {
    const serialized = JSON.stringify(value, BufferJSON.replacer);
    await db.whatsAppAuthKey.upsert({
      where: { shop_keyType_keyId: { shop, keyType: type, keyId: id } },
      create: { shop, keyType: type, keyId: id, value: serialized },
      update: { value: serialized },
    });
  };

  const removeKey = async (type: string, id: string) => {
    await db.whatsAppAuthKey.deleteMany({
      where: { shop, keyType: type, keyId: id },
    });
  };

  // -----------------------------------------------------------------------
  // Build the AuthenticationState expected by Baileys
  // -----------------------------------------------------------------------
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        await Promise.all(
          ids.map(async (id) => {
            const value = await readKey(type, id);
            if (value) {
              result[id] = value;
            }
          })
        );
        return result;
      },
      set: async (data: any) => {
        const ops: Promise<void>[] = [];
        for (const type in data) {
          for (const id in data[type]) {
            const value = data[type][id];
            if (value) {
              ops.push(writeKey(type, id, value));
            } else {
              ops.push(removeKey(type, id));
            }
          }
        }
        await Promise.all(ops);
      },
    },
  };

  return { state, saveCreds };
}
