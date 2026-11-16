/**
 * End-to-end encryption for a synced repository. Everything happens in the
 * browser with Web Crypto; GitHub only ever stores ciphertext.
 *
 * Keys
 * - A random 32-byte **repository key** encrypts everything. Its text form is
 *   the **recovery key**.
 * - The repository key is stored in the repo, in `.noted/encryption.json`,
 *   encrypted with a key derived from the user's passphrase (PBKDF2-SHA256).
 * - Each device keeps the derived working keys in IndexedDB as non-extractable
 *   CryptoKeys, so the passphrase is asked for once per device.
 *
 * Deterministic encryption (SIV construction)
 * - The IV is an HMAC of the plaintext, so the same content always encrypts to
 *   the same bytes. That keeps git's blob ids meaningful: sync can tell what
 *   changed without downloading, and three-way merges can fetch old versions by
 *   id. It reveals only that two files are identical, which git shows anyway.
 * - File names are encrypted the same way and written in lowercase base32, so
 *   they survive case-insensitive file systems.
 */

export const HEADER_PATH = ".noted/encryption.json";
/** Where encrypted files live in the repo. */
export const ENCRYPTED_DIR = "encrypted";
const FORMAT = "noted-ai-encryption";
const MAGIC = new TextEncoder().encode("nae1");
/** Longest folder or file name written; longer encrypted names are split into folders. */
const SEGMENT = 200;
export const DEFAULT_ITERATIONS = 600_000;

export interface EncryptionHeader {
  format: typeof FORMAT;
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  /** The repository key, AES-GCM encrypted with the passphrase key: base64 of iv ‖ ciphertext. */
  wrappedKey: string;
  /** Lets a recovery key be checked before use. */
  keyCheck: string;
}

/** The working keys for one repository. */
export interface RepoKeys {
  aes: CryptoKey;
  siv: CryptoKey;
}

export class WrongKeyError extends Error {
  constructor(what: "passphrase" | "recovery key") {
    super(what === "passphrase" ? "That passphrase isn't right." : "That recovery key isn't right.");
  }
}

export class DecryptError extends Error {
  constructor() {
    super("A file couldn't be decrypted. It may be damaged, or encrypted with a different key.");
  }
}

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const bytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** Web Crypto wants ArrayBuffer-backed views. */
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function toBase32(b: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const x of b) {
    value = (value << 8) | x;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not base32.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/* ---------- Keys ---------- */

async function passphraseKey(passphrase: string, kdf: EncryptionHeader["kdf"]): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: buf(fromBase64(kdf.salt)) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function hkdf(master: Uint8Array, info: string, bits: number): Promise<Uint8Array> {
  const base = await subtle().importKey("raw", buf(master), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, base, bits),
  );
}

/** Working keys from the repository key. They can't be exported again. */
export async function keysFromMaster(master: Uint8Array): Promise<RepoKeys> {
  const [aesRaw, sivRaw] = await Promise.all([hkdf(master, "noted-ai aes", 256), hkdf(master, "noted-ai siv", 256)]);
  const [aes, siv] = await Promise.all([
    subtle().importKey("raw", buf(aesRaw), "AES-GCM", false, ["encrypt", "decrypt"]),
    subtle().importKey("raw", buf(sivRaw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  ]);
  return { aes, siv };
}

const keyCheck = async (master: Uint8Array) => toBase64(await hkdf(master, "noted-ai key check", 128));

/**
 * Turns encryption on: a new random repository key, locked with `passphrase`.
 * Returns the header to commit, the working keys, and the recovery key to show
 * the user once.
 */
export async function createEncryption(
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<{ header: EncryptionHeader; keys: RepoKeys; recoveryKey: string }> {
  const master = bytes(32);
  const kdf = { name: "PBKDF2" as const, hash: "SHA-256" as const, iterations, salt: toBase64(bytes(16)) };
  const kek = await passphraseKey(passphrase, kdf);
  const iv = bytes(12);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, kek, master));
  const header: EncryptionHeader = {
    format: FORMAT,
    version: 1,
    kdf,
    wrappedKey: toBase64(concat(iv, wrapped)),
    keyCheck: await keyCheck(master),
  };
  const result = { header, keys: await keysFromMaster(master), recoveryKey: formatRecoveryKey(master) };
  master.fill(0);
  return result;
}

/** Unlocks with the passphrase. Throws WrongKeyError if it doesn't fit. */
export async function unlockWithPassphrase(header: EncryptionHeader, passphrase: string): Promise<RepoKeys> {
  const kek = await passphraseKey(passphrase, header.kdf);
  const wrapped = fromBase64(header.wrappedKey);
  let master: Uint8Array;
  try {
    master = new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv: buf(wrapped.slice(0, 12)) }, kek, buf(wrapped.slice(12))),
    );
  } catch {
    throw new WrongKeyError("passphrase");
  }
  const keys = await keysFromMaster(master);
  master.fill(0);
  return keys;
}

/** Unlocks with the recovery key. Throws WrongKeyError if it doesn't fit. */
export async function unlockWithRecoveryKey(header: EncryptionHeader, recoveryKey: string): Promise<RepoKeys> {
  const master = parseRecoveryKey(recoveryKey);
  if (!master || (await keyCheck(master)) !== header.keyCheck) throw new WrongKeyError("recovery key");
  const keys = await keysFromMaster(master);
  master.fill(0);
  return keys;
}

/** "abcd-efgh-…": 52 base32 characters in groups of four. */
export function formatRecoveryKey(master: Uint8Array): string {
  return toBase32(master).match(/.{1,4}/g)!.join("-");
}

export function parseRecoveryKey(text: string): Uint8Array | null {
  const clean = text.toLowerCase().replace(/[^a-z2-7]/g, "");
  if (clean.length !== 52) return null;
  try {
    return fromBase32(clean);
  } catch {
    return null;
  }
}

export function parseHeader(text: string): EncryptionHeader | null {
  try {
    const h = JSON.parse(text) as EncryptionHeader;
    if (h?.format !== FORMAT || h.version !== 1 || h.kdf?.name !== "PBKDF2") return null;
    if (typeof h.wrappedKey !== "string" || typeof h.keyCheck !== "string") return null;
    return h;
  } catch {
    return null;
  }
}

export function serializeHeader(h: EncryptionHeader): string {
  return JSON.stringify(h, null, 2) + "\n";
}

/* ---------- Deterministic encryption ---------- */

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type Domain = "content" | "name";
const DOMAIN: Record<Domain, Uint8Array> = { content: Uint8Array.of(1), name: Uint8Array.of(2) };

async function sivEncrypt(keys: RepoKeys, domain: Domain, plain: Uint8Array): Promise<Uint8Array> {
  const mac = new Uint8Array(await subtle().sign("HMAC", keys.siv, concat(DOMAIN[domain], plain)));
  const iv = mac.slice(0, 12);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv, additionalData: buf(DOMAIN[domain]) }, keys.aes, buf(plain)),
  );
  return concat(iv, ct);
}

async function sivDecrypt(keys: RepoKeys, domain: Domain, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 28) throw new DecryptError();
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: buf(data.slice(0, 12)), additionalData: buf(DOMAIN[domain]) },
        keys.aes,
        buf(data.slice(12)),
      ),
    );
  } catch {
    throw new DecryptError();
  }
}

/** Encrypts a file's content. Same content, same bytes. */
export async function encryptContent(keys: RepoKeys, content: string | Uint8Array): Promise<Uint8Array> {
  const plain = typeof content === "string" ? enc.encode(content) : content;
  return concat(MAGIC, await sivEncrypt(keys, "content", plain));
}

export async function decryptContent(keys: RepoKeys, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < MAGIC.length || MAGIC.some((b, i) => data[i] !== b)) throw new DecryptError();
  return sivDecrypt(keys, "content", data.slice(MAGIC.length));
}

/** The repo path an encrypted file is stored at: `encrypted/<name>`, long names split into folders. */
export async function encryptPath(keys: RepoKeys, path: string): Promise<string> {
  const name = toBase32(await sivEncrypt(keys, "name", enc.encode(path)));
  const segments = name.match(new RegExp(`.{1,${SEGMENT}}`, "g"))!;
  return [ENCRYPTED_DIR, ...segments].join("/");
}

/** The original path of a stored file, or null if it isn't one of ours. */
export async function decryptPath(keys: RepoKeys, stored: string): Promise<string | null> {
  if (!stored.startsWith(ENCRYPTED_DIR + "/")) return null;
  const name = stored.slice(ENCRYPTED_DIR.length + 1).replaceAll("/", "");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await sivDecrypt(keys, "name", fromBase32(name)));
  } catch {
    return null;
  }
}
