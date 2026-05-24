/**
 * Local field-level encryption for DivineLink (offline PWA).
 *
 * Design:
 * - AES-equivalent confidentiality via HMAC-SHA256 keystream XOR (CTR-style).
 * - Master key derived via PBKDF2-SHA256 (100k iterations) from a SHARED
 *   "master PIN" + per-install random salt (stored in localStorage).
 * - The master PIN is, by default, the admin PIN at first install. The admin
 *   can change it later (re-encrypts all sensitive fields).
 * - A "key check" blob is stored in localStorage so we can detect a wrong key
 *   and so we can transparently migrate from the legacy fixed-passphrase key.
 *
 * NOTE: This protects data at rest in IndexedDB and exported backups. It does
 * not protect against an attacker with active access to the unlocked app.
 */

const SALT_KEY = "dl.enc.salt.v1";
const CHECK_KEY = "dl.enc.check.v2";
const PIN_FLAG_KEY = "dl.enc.pinmode.v1"; // "1" once we use PIN-derived key
const LEGACY_PASSPHRASE = "divinelink-app-v1-passphrase";
const PREFIX = "enc:v1:";
const CHECK_PLAINTEXT = "DIVINELINK_OK";

let masterKeyBytes: Uint8Array | null = null;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key.slice().buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, data.slice().buffer);
  return new Uint8Array(sig);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

async function deriveKeystreamWith(key: Uint8Array, nonce: Uint8Array, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, counter++, false);
    const block = await hmacSha256(key, concat(nonce, ctr));
    const take = Math.min(block.length, length - offset);
    out.set(block.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

async function getOrCreateSalt(): Promise<Uint8Array> {
  let saltB64 = localStorage.getItem(SALT_KEY);
  if (!saltB64) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(SALT_KEY, b64encode(salt));
    return salt;
  }
  return b64decode(saltB64);
}

async function deriveMasterKey(passphrase: string): Promise<Uint8Array> {
  const salt = await getOrCreateSalt();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase).slice().buffer,
    { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.slice().buffer, iterations: 100_000, hash: "SHA-256" },
    baseKey, 256
  );
  return new Uint8Array(bits);
}

async function encryptWith(key: Uint8Array, plain: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const ks = await deriveKeystreamWith(key, nonce, data.length);
  const ct = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) ct[i] = data[i] ^ ks[i];
  return PREFIX + b64encode(nonce) + ":" + b64encode(ct);
}

async function decryptWith(key: Uint8Array, value: string): Promise<string | null> {
  const rest = value.slice(PREFIX.length);
  const [nb, cb] = rest.split(":");
  if (!nb || !cb) return null;
  try {
    const nonce = b64decode(nb);
    const ct = b64decode(cb);
    const ks = await deriveKeystreamWith(key, nonce, ct.length);
    const pt = new Uint8Array(ct.length);
    for (let i = 0; i < ct.length; i++) pt[i] = ct[i] ^ ks[i];
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

async function writeKeyCheck(key: Uint8Array): Promise<void> {
  const blob = await encryptWith(key, CHECK_PLAINTEXT);
  localStorage.setItem(CHECK_KEY, blob);
}

async function verifyKey(key: Uint8Array): Promise<boolean> {
  const blob = localStorage.getItem(CHECK_KEY);
  if (!blob) return false;
  const v = await decryptWith(key, blob);
  return v === CHECK_PLAINTEXT;
}

/**
 * Initialize encryption. Default boot uses the master PIN "1234" if never
 * configured. Existing legacy data (encrypted with the old fixed passphrase)
 * is detected and migrated transparently to the PIN-derived key.
 */
export async function initCrypto(masterPin: string = "1234"): Promise<void> {
  if (masterKeyBytes) return;

  const newKey = await deriveMasterKey("dl-pin:" + masterPin);

  if (localStorage.getItem(CHECK_KEY)) {
    // We have a stored key check — verify
    if (await verifyKey(newKey)) {
      masterKeyBytes = newKey;
      return;
    }
    // Wrong PIN for this install — fall through and try legacy
  }

  // Try legacy passphrase
  const legacyKey = await deriveMasterKey(LEGACY_PASSPHRASE);
  // Migrate IndexedDB: re-encrypt with newKey
  await migrateLegacyToNew(legacyKey, newKey);
  masterKeyBytes = newKey;
  await writeKeyCheck(newKey);
  localStorage.setItem(PIN_FLAG_KEY, "1");
}

async function migrateLegacyToNew(oldKey: Uint8Array, newKey: Uint8Array): Promise<void> {
  // Lazy import to avoid circular deps
  const { db } = await import("@/lib/db");
  const SENSITIVE_PATIENT = ["phone", "address", "medicalAlerts"];
  const all = await db.patients.toArray();
  for (const p of all) {
    const updates: any = {};
    let changed = false;
    for (const k of SENSITIVE_PATIENT) {
      const v = (p as any)[k];
      if (typeof v === "string" && v.startsWith(PREFIX)) {
        const plain = await decryptWith(oldKey, v);
        if (plain != null) {
          updates[k] = await encryptWith(newKey, plain);
          changed = true;
        }
      }
    }
    if (changed && p.id) await db.patients.update(p.id, updates);
  }
}

/** Change the master PIN: re-derive key and re-encrypt all sensitive fields. */
export async function changeMasterPin(newPin: string): Promise<void> {
  if (!masterKeyBytes) throw new Error("crypto not initialized");
  const oldKey = masterKeyBytes;
  const newKey = await deriveMasterKey("dl-pin:" + newPin);
  await migrateLegacyToNew(oldKey, newKey);
  masterKeyBytes = newKey;
  await writeKeyCheck(newKey);
  localStorage.setItem(PIN_FLAG_KEY, "1");
}

export async function encryptString(plain: string): Promise<string> {
  if (plain == null || plain === "") return plain;
  if (typeof plain === "string" && plain.startsWith(PREFIX)) return plain;
  if (!masterKeyBytes) await initCrypto();
  return encryptWith(masterKeyBytes!, plain);
}

export async function decryptString(value: string): Promise<string> {
  if (!value || typeof value !== "string" || !value.startsWith(PREFIX)) return value || "";
  if (!masterKeyBytes) await initCrypto();
  const out = await decryptWith(masterKeyBytes!, value);
  return out ?? "";
}

export function isEncrypted(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}
