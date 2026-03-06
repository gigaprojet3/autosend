import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import db from '../db.server';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';

const sessions = new Map<string, any>();
const qrCodes = new Map<string, string>();
const sessionStatus = new Map<string, 'initializing' | 'needs_qr' | 'connected' | 'disconnected'>();

// Simple in-memory store replacing makeInMemoryStore
const chatStores = new Map<string, Map<string, any>>(); // shop -> chatId -> chat info
const messageStores = new Map<string, Map<string, any>>(); // shop -> msgId -> message

const SESSION_DIR = path.resolve(process.cwd(), 'whatsapp_sessions');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function getOrCreateChatStore(shop: string): Map<string, any> {
  if (!chatStores.has(shop)) {
    chatStores.set(shop, new Map());
  }
  return chatStores.get(shop)!;
}

function getOrCreateMessageStore(shop: string): Map<string, any> {
  if (!messageStores.has(shop)) {
    messageStores.set(shop, new Map());
  }
  return messageStores.get(shop)!;
}

export async function initWhatsApp(shop: string) {
  try {
    if (sessions.has(shop) && sessionStatus.get(shop) === 'connected') {
      console.log(`Session already exists for shop: ${shop}`);
      return sessions.get(shop);
    }

    console.log(`Initializing WhatsApp for shop: ${shop}`);
    sessionStatus.set(shop, 'initializing');

    const { state, saveCreds } = await useMultiFileAuthState(path.join(SESSION_DIR, shop));
    const { version } = await fetchLatestBaileysVersion();

    const chatStore = getOrCreateChatStore(shop);
    const messageStore = getOrCreateMessageStore(shop);

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
      getMessage: async (key) => {
        const msg = messageStore.get(key.id!);
        return msg?.message || { conversation: 'hello' };
      }
    });

    sessions.set(shop, sock);

    // Track chats from initial history sync (replaces removed 'chats.set' event)
    sock.ev.on('messaging-history.set', ({ chats }) => {
      for (const chat of chats) {
        if (chat.id) {
          chatStore.set(chat.id, chat);
        }
      }
      console.log(`📋 Loaded ${chats.length} chats for ${shop}`);
    });

    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (chat.id) {
          chatStore.set(chat.id, chat);
        }
      }
    });

    sock.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        const existing = chatStore.get(update.id!);
        if (existing) {
          chatStore.set(update.id!, { ...existing, ...update });
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.id) {
          messageStore.set(msg.key.id, msg);
        }
        // Also track chat from message
        const chatId = msg.key.remoteJid;
        if (chatId && !chatStore.has(chatId)) {
          chatStore.set(chatId, {
            id: chatId,
            name: (msg as any).pushName || chatId.replace('@s.whatsapp.net', '').replace('@g.us', ''),
          });
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
  chatStores.delete(shop);
  messageStores.delete(shop);

  const sessionPath = path.join(SESSION_DIR, shop);
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`📁 Session files deleted for shop: ${shop}`);
    } catch (error) {
      console.error(`❌ Error deleting session files:`, error);
    }
  }

  try {
    await db.whatsAppSession.delete({ where: { shop } });
    console.log(`💾 DB session cleared for shop: ${shop}`);
  } catch (error) {
    console.error(`❌ Error clearing DB session:`, error);
  }
}

export async function getChats(shop: string) {
  const sock = sessions.get(shop);
  if (!sock) throw new Error('No active session');

  const chatStore = getOrCreateChatStore(shop);

  console.log(`📱 Fetching chats for shop: ${shop}, store size: ${chatStore.size}`);

  const chats = Array.from(chatStore.values()).filter((chat: any) => chat && chat.id);

  const formattedChats = chats.map((chat: any) => ({
    id: chat.id,
    name: chat.name || chat.subject || chat.id.replace('@s.whatsapp.net', '').replace('@g.us', ''),
    isGroup: chat.id.includes('@g.us') || !!chat.subject,
    unreadCount: chat.unreadCount || 0
  }));

  console.log(`📋 Total chats: ${formattedChats.length}`);

  return formattedChats.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

export async function sendMessage(shop: string, recipient: string, text: string) {
  const sock = sessions.get(shop);
  if (!sock) throw new Error('No active session');

  await sock.sendMessage(recipient, { text });
}
