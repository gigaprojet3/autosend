import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

// ── Key management ──────────────────────────────────────────────────

let _cachedKey: Buffer | null | undefined;

function getKey(): Buffer | null {
  if (_cachedKey !== undefined) return _cachedKey;

  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    console.warn(
      "⚠️  ENCRYPTION_KEY not set — user data will NOT be encrypted. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    _cachedKey = null;
    return null;
  }
  if (hex.length !== 64) {
    console.error("❌ ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
    _cachedKey = null;
    return null;
  }
  _cachedKey = Buffer.from(hex, "hex");
  return _cachedKey;
}

// ── Encrypt / Decrypt ───────────────────────────────────────────────

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  // Not encrypted (legacy / unencrypted data) — return as-is
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;

  const key = getKey();
  if (!key) return ciphertext; // Can't decrypt without key

  const parts = ciphertext.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return ciphertext; // Malformed — return as-is

  try {
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const encrypted = Buffer.from(parts[2], "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    console.error("❌ Decryption failed — returning raw value");
    return ciphertext;
  }
}

// ── Field map: model → sensitive fields to encrypt ──────────────────
// Only pure "data" fields — never fields used in WHERE / indexes / unique constraints.

export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  WhatsAppSession: ["creds", "targetJid"],
  WhatsAppAuthKey: ["value"],
  WhatsAppChat: ["name", "metadata"],
  WhatsAppContact: ["name", "notify", "metadata"],
  MessageLog: ["customerName", "content", "error"],
  SelectedProduct: ["title", "imageUrl"],
};

// ── Object helpers ──────────────────────────────────────────────────

export function encryptObject(obj: any, fields: string[]) {
  if (!obj || typeof obj !== "object") return;
  for (const field of fields) {
    if (typeof obj[field] === "string") {
      obj[field] = encrypt(obj[field]);
    }
  }
}

export function decryptObject(obj: any, fields: string[]) {
  if (!obj || typeof obj !== "object") return;
  for (const field of fields) {
    if (typeof obj[field] === "string") {
      obj[field] = decrypt(obj[field]);
    }
  }
}
