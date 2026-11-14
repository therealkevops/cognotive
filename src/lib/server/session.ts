/**
 * The sign-in session, sealed into an httpOnly cookie with AES-GCM. The key is
 * derived from SESSION_SECRET, so nothing is stored server-side (Hobby has no
 * database, and functions are stateless).
 */

export interface Session {
  /** GitHub user id and login. */
  uid: number;
  login: string;
  /** User-to-server access token (8 h) and its expiry, ms since epoch. */
  at: string;
  atExp: number;
  /** Refresh token (~6 months) and its expiry. GitHub rotates it on every refresh. */
  rt: string;
  rtExp: number;
}

export const SESSION_COOKIE = "noted_session";
export const STATE_COOKIE = "noted_oauth_state";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export async function seal(data: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(JSON.stringify(data))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64url(out);
}

/** Returns undefined if the value is missing, tampered with, or sealed with another secret. */
export async function unseal<T>(value: string | undefined, secret: string): Promise<T | undefined> {
  if (!value) return undefined;
  try {
    const bytes = fromB64url(value);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await key(secret),
      bytes.slice(12),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return undefined;
  }
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: maxAgeSeconds,
  };
}
