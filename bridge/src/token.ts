import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Where the bridge keeps its pairing code: ~/.cognotive (or COGNOTIVE_HOME). A ~/.noted-ai left by
 * the app's earlier name is still used, so an existing pairing keeps working.
 */
export function bridgeHome(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  const set = env.COGNOTIVE_HOME || env.NOTED_AI_HOME;
  if (set) return set;
  const current = path.join(home, ".cognotive");
  const earlier = path.join(home, ".noted-ai");
  return !existsSync(current) && existsSync(earlier) ? earlier : current;
}

/** The pairing code the app sends as a bearer token, kept between runs (readable only by this user). */
export async function readOrCreateToken({ env = process.env as Record<string, string | undefined>, renew = false } = {}): Promise<{ token: string; created: boolean }> {
  const dir = bridgeHome(env);
  const file = path.join(dir, "bridge-token");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (!renew) {
    try {
      const token = (await fs.readFile(file, "utf8")).trim();
      if (/^[a-f0-9]{48}$/.test(token)) return { token, created: false };
    } catch {
      /* none yet */
    }
  }
  const token = crypto.randomBytes(24).toString("hex");
  await fs.writeFile(file, token + "\n", { mode: 0o600 });
  await fs.chmod(file, 0o600);
  return { token, created: true };
}

export function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const a = Buffer.from(authorization.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
