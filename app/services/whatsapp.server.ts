import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import db from '../db.server';
import qrcode from 'qrcode';
import { useDBAuthState } from './useDBAuthState';

const sessions = new Map<string, any>();
const qrCodes = new Map<string, string>();
const sessionStatus = new Map<string, 'initializing' | 'needs_qr' | 'connected' | 'disconnected'>();

// ---------------------------------------------------------------------------
// Message Queue — ensures messages are sent sequentially, never in parallel
// ---------------------------------------------------------------------------
interface QueuedMessage {
  shop: string;
  recipient: string;
  text: string;
  resolve: (value: void) => void;
  reject: (reason?: any) => void;
}

const messageQueue: QueuedMessage[] = [];
let queueProcessing = false;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates a realistic "typing" delay based on message length.
 * ~50-80 ms per character (≈ average human typing speed) clamped to 2-12 s.
 */
function computeTypingDelay(text: string): number {
  const msPerChar = randomInt(50, 80);
  const raw = text.length * msPerChar;
  return Math.max(2000, Math.min(raw, 12000));
}

/**
 * Returns a random delay between 15 000 ms and 30 000 ms.
 */
function randomInterMessageDelay(): number {
  return randomInt(15000, 30000);
}

// ---------------------------------------------------------------------------
// Text‑variation helper
// ---------------------------------------------------------------------------
const GREETING_VARIANTS = [
  'Bonjour',
  'Salut',
  'Hey',
  'Coucou',
  'Hello',
  'Bonsoir',
];

const CLOSING_VARIANTS = [
  'Merci !',
  'Merci beaucoup !',
  'Cordialement',
  'Bonne journée !',
  'À bientôt !',
  'Bien à vous',
];

/**
 * Slightly varies a message to look more human:
 *  - Replaces {{greeting}} with a random greeting
 *  - Replaces {{closing}} with a random closing
 *  - Optionally adds/removes trailing punctuation
 */
export function varyText(text: string): string {
  let varied = text;
  varied = varied.replace(
    /\{\{greeting\}\}/gi,
    GREETING_VARIANTS[randomInt(0, GREETING_VARIANTS.length - 1)],
  );
  varied = varied.replace(
    /\{\{closing\}\}/gi,
    CLOSING_VARIANTS[randomInt(0, CLOSING_VARIANTS.length - 1)],
  );
  return varied;
}

// ---------------------------------------------------------------------------
// Queue processor
// ---------------------------------------------------------------------------
async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;

  while (messageQueue.length > 0) {
    const job = messageQueue.shift()!;
    try {
      const sock = sessions.get(job.shop);
      if (!sock) throw new Error('No active session');

      const finalText = varyText(job.text);

      // 1. Show "composing…" presence
      await sock.sendPresenceUpdate('composing', job.recipient);

      // 2. Wait a realistic typing duration
      const typingMs = computeTypingDelay(finalText);
      console.log(`⌨️  Typing for ${(typingMs / 1000).toFixed(1)}s before sending to ${job.recipient}`);
      await sleep(typingMs);

      // 3. Stop composing & send
      await sock.sendPresenceUpdate('paused', job.recipient);
      await sock.sendMessage(job.recipient, { text: finalText });
      console.log(`✅ Message sent to ${job.recipient} (${finalText.length} chars)`);

      job.resolve();
    } catch (err) {
      console.error(`❌ Failed to send message to ${job.recipient}:`, err);
      job.reject(err);
    }

    // 4. Random inter-message pause if more items remain
    if (messageQueue.length > 0) {
      const pause = randomInterMessageDelay();
      console.log(`⏳ Waiting ${(pause / 1000).toFixed(1)}s before next message…`);
      await sleep(pause);
    }
  }

  queueProcessing = false;
}

// ---------------------------------------------------------------------------
// Bounded getMessage cache (in-memory, for Baileys retry mechanism only)
// ---------------------------------------------------------------------------
const msgCache = new Map<string, Map<string, any>>();
const MSG_CACHE_MAX = 500;

function getMessageCache(shop: string): Map<string, any> {
  if (!msgCache.has(shop)) {
    msgCache.set(shop, new Map());
  }
  return msgCache.get(shop)!;
}

function addToMessageCache(shop: string, msgId: string, msg: any) {
  const cache = getMessageCache(shop);
  cache.set(msgId, msg);
  if (cache.size > MSG_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

// ---------------------------------------------------------------------------
// DB persistence helpers — batch upsert chats & contacts
// ---------------------------------------------------------------------------
async function persistChats(shop: string, chats: any[]) {
  const valid = chats.filter((c: any) => c && c.id);
  if (valid.length === 0) return;
  await db.$transaction(
    valid.map((chat: any) => {
      const isGroup = chat.id.includes('@g.us') || !!chat.subject;
      const name = chat.subject || chat.name || null;
      return db.whatsAppChat.upsert({
        where: { shop_jid: { shop, jid: chat.id } },
        create: { shop, jid: chat.id, name, isGroup, metadata: JSON.stringify(chat) },
        update: { ...(name ? { name } : {}), isGroup, metadata: JSON.stringify(chat) },
      });
    })
  );
}

async function persistContacts(shop: string, contacts: any[]) {
  const valid = contacts.filter((c: any) => c && c.id);
  if (valid.length === 0) return;
  await db.$transaction(
    valid.map((contact: any) => {
      return db.whatsAppContact.upsert({
        where: { shop_jid: { shop, jid: contact.id } },
        create: {
          shop,
          jid: contact.id,
          name: contact.name || null,
          notify: contact.notify || null,
          metadata: JSON.stringify(contact),
        },
        update: {
          ...(contact.name ? { name: contact.name } : {}),
          ...(contact.notify ? { notify: contact.notify } : {}),
          metadata: JSON.stringify(contact),
        },
      });
    })
  );
}

export async function initWhatsApp(shop: string) {
  try {
    if (sessions.has(shop) && sessionStatus.get(shop) === 'connected') {
      console.log(`Session already exists for shop: ${shop}`);
      return sessions.get(shop);
    }

    console.log(`Initializing WhatsApp for shop: ${shop}`);
    sessionStatus.set(shop, 'initializing');

    // Auth state persisted in DB (replaces useMultiFileAuthState)
    const { state, saveCreds } = await useDBAuthState(shop);
    const { version } = await fetchLatestBaileysVersion();

    const cache = getMessageCache(shop);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ['Autosend', 'Chrome', '1.0.0'],
      version,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      qrTimeout: 45000,
      markOnlineOnConnect: true,
      shouldSyncHistoryMessage: () => true,
      syncFullHistory: true,
      getMessage: async (key) => {
        const msg = cache.get(key.id!);
        return msg?.message || { conversation: 'hello' };
      }
    });

    sessions.set(shop, sock);

    // Track chats and contacts from initial history sync → persist to DB
    // messaging-history.set fires multiple times as chunks arrive
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest, progress, syncType }) => {
      // Persist chats to DB (fire-and-forget, errors logged)
      persistChats(shop, chats).catch((e) => console.error('❌ persistChats error:', e));

      // Persist contacts to DB
      if (contacts && contacts.length > 0) {
        persistContacts(shop, contacts).catch((e) => console.error('❌ persistContacts error:', e));
      }

      // Only cache recent messages for getMessage (bounded, not accumulated)
      if (messages) {
        for (const msg of messages) {
          if (msg.key?.id) {
            addToMessageCache(shop, msg.key.id, msg);
          }
          // Extract chat/contact from message and persist
          const chatId = msg.key?.remoteJid;
          if (chatId && (msg as any).pushName) {
            persistContacts(shop, [{ id: chatId, notify: (msg as any).pushName }])
              .catch(() => {});
            persistChats(shop, [{
              id: chatId,
              name: (msg as any).pushName || chatId.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            }]).catch(() => {});
          }
        }
      }

      console.log(`📋 History sync [${syncType ?? '?'}] — +${chats.length} chats, +${contacts?.length ?? 0} contacts, +${messages?.length ?? 0} msgs | Progress: ${progress ?? '?'}% ${isLatest ? '(COMPLETE)' : ''}`);
    });

    sock.ev.on('chats.upsert', (chats) => {
      persistChats(shop, chats).catch((e) => console.error('❌ chats.upsert persist error:', e));
    });

    sock.ev.on('chats.update', (updates) => {
      persistChats(shop, updates).catch((e) => console.error('❌ chats.update persist error:', e));
    });

    // Track contacts → persist to DB
    sock.ev.on('contacts.upsert', (contacts) => {
      persistContacts(shop, contacts).catch((e) => console.error('❌ contacts.upsert persist error:', e));
      console.log(`👤 Upserted ${contacts.length} contacts for ${shop}`);
    });

    sock.ev.on('contacts.update', (updates) => {
      persistContacts(shop, updates).catch((e) => console.error('❌ contacts.update persist error:', e));
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        // Bounded cache for getMessage retries only
        if (msg.key.id) {
          addToMessageCache(shop, msg.key.id, msg);
        }
        // Persist chat/contact discovered from new messages
        const chatId = msg.key.remoteJid;
        if (chatId) {
          persistChats(shop, [{
            id: chatId,
            name: (msg as any).pushName || chatId.replace('@s.whatsapp.net', '').replace('@g.us', ''),
          }]).catch(() => {});
          if ((msg as any).pushName) {
            persistContacts(shop, [{ id: chatId, notify: (msg as any).pushName }]).catch(() => {});
          }
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isOnline } = update;

      if (qr) {
        console.log(`✅ QR Code generated for shop: ${shop}`);
        console.log(`⏰ QR Code expires in 45 seconds`);
        const url = await qrcode.toDataURL(qr);
        qrCodes.set(shop, url);
        sessionStatus.set(shop, 'needs_qr');

        setTimeout(() => {
          if (sessionStatus.get(shop) === 'needs_qr') {
            console.log(`⏰ QR Code expired for shop: ${shop}`);
            qrCodes.delete(shop);
            sessionStatus.set(shop, 'disconnected');
          }
        }, 45000);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`❌ Connection closed for ${shop}, status: ${statusCode}, reconnect: ${shouldReconnect}`);

        // Free memory on disconnect
        msgCache.delete(shop);

        if (!shouldReconnect) {
          console.log(`🚪 Logged out for shop: ${shop} - session cleared`);
          qrCodes.delete(shop);
          sessions.delete(shop);
          sessionStatus.set(shop, 'disconnected');
        } else {
          console.log(`🔄 Attempting to reconnect for shop: ${shop}`);
          sessionStatus.set(shop, 'initializing');
          setTimeout(() => initWhatsApp(shop), 3000);
        }
      } else if (connection === 'open') {
        console.log(`✅ Connection opened successfully for ${shop}, online: ${isOnline}`);
        qrCodes.delete(shop);
        sessions.set(shop, sock);
        sessionStatus.set(shop, 'connected');

        try {
          await db.whatsAppSession.upsert({
            where: { shop },
            create: { shop },
            update: { updatedAt: new Date() }
          });
          console.log(`💾 Session saved to database for ${shop}`);
        } catch (dbError) {
          console.error('❌ Error updating DB session:', dbError);
        }
      } else if (connection === 'connecting') {
        console.log(`🔌 Connecting to WhatsApp for shop: ${shop}...`);
        sessionStatus.set(shop, 'initializing');
      }
    });

    return sock;
  } catch (error) {
    console.error('Error initializing WhatsApp:', error);
    sessions.delete(shop);
    sessionStatus.set(shop, 'disconnected');
    throw error;
  }
}

export async function getQrCode(shop: string) {
  return qrCodes.get(shop);
}

export async function getSessionStatus(shop: string) {
  return sessionStatus.get(shop) || 'disconnected';
}

export async function clearSession(shop: string) {
  console.log(`🧹 Clearing session for shop: ${shop}`);
  sessions.delete(shop);
  qrCodes.delete(shop);
  sessionStatus.set(shop, 'disconnected');
  msgCache.delete(shop);

  try {
    // Cascade delete removes authKeys, chats, contacts automatically
    await db.whatsAppSession.delete({ where: { shop } });
    console.log(`💾 DB session + auth keys + chats + contacts cleared for shop: ${shop}`);
  } catch (error) {
    console.error(`❌ Error clearing DB session:`, error);
  }
}

export async function getChats(shop: string) {
  const sock = sessions.get(shop);
  if (!sock) throw new Error('No active session');

  // Query ONLY groups from DB (skip individual contacts for speed)
  const dbChats = await db.whatsAppChat.findMany({
    where: { shop, isGroup: true },
  });

  console.log(`📱 Fetching groups for shop: ${shop}, DB has ${dbChats.length} groups`);

  const formattedChats = await Promise.all(dbChats.map(async (chat) => {
    let name: string;
    let profilePicUrl: string | null = null;

    // Fetch real group metadata from WhatsApp servers
    try {
      const metadata = await sock.groupMetadata(chat.jid);
      name = metadata.subject || chat.name || chat.jid.replace('@g.us', '');
    } catch {
      name = chat.name || chat.jid.replace('@g.us', '');
    }

    // Récupérer la photo de profil
    try {
      profilePicUrl = await sock.profilePictureUrl(chat.jid, 'image');
    } catch {
      // Pas de photo de profil disponible
    }

    return {
      id: chat.jid,
      name,
      isGroup: true,
      unreadCount: 0,
      profilePicUrl
    };
  }));

  console.log(`📋 Total groups: ${formattedChats.length}`);

  return formattedChats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Enqueues a message to be sent with human-like delays.
 * - Simulates "composing" presence
 * - Typing delay proportional to message length
 * - 15-30 s pause between consecutive messages
 * - Supports {{greeting}} / {{closing}} placeholders for text variation
 */
export function sendMessage(shop: string, recipient: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    messageQueue.push({ shop, recipient, text, resolve, reject });
    processQueue();
  });
}
