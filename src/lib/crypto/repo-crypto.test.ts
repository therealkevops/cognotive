import { describe, expect, it } from "vitest";
import {
  createEncryption,
  decryptContent,
  decryptPath,
  encryptContent,
  encryptPath,
  fromBase32,
  parseHeader,
  parseRecoveryKey,
  serializeHeader,
  toBase32,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  WrongKeyError,
  DecryptError,
} from "./repo-crypto";

const ITER = 1000; // fast for tests; the app uses 600,000

describe("keys", () => {
  it("unlocks with the passphrase or the recovery key, and both give the same keys", async () => {
    const { header, keys, recoveryKey } = await createEncryption("correct horse", ITER);
    expect(recoveryKey).toMatch(/^([a-z2-7]{4}-){12}[a-z2-7]{4}$/);
    const sample = await encryptContent(keys, "hello");
    const viaPass = await unlockWithPassphrase(header, "correct horse");
    const viaRecovery = await unlockWithRecoveryKey(header, recoveryKey.toUpperCase().replaceAll("-", " "));
    expect(await encryptContent(viaPass, "hello")).toEqual(sample);
    expect(await encryptContent(viaRecovery, "hello")).toEqual(sample);
  });

  it("rejects a wrong passphrase or recovery key", async () => {
    const { header } = await createEncryption("right", ITER);
    await expect(unlockWithPassphrase(header, "wrong")).rejects.toBeInstanceOf(WrongKeyError);
    const other = await createEncryption("x", ITER);
    await expect(unlockWithRecoveryKey(header, other.recoveryKey)).rejects.toBeInstanceOf(WrongKeyError);
    await expect(unlockWithRecoveryKey(header, "nope")).rejects.toBeInstanceOf(WrongKeyError);
  });

  it("the header holds no key material in the clear and round-trips", async () => {
    const { header, recoveryKey } = await createEncryption("pw", ITER);
    const text = serializeHeader(header);
    expect(text).not.toContain(recoveryKey.replaceAll("-", ""));
    expect(parseHeader(text)).toEqual(header);
    expect(parseHeader("{}")).toBeNull();
    expect(parseRecoveryKey(recoveryKey)).toHaveLength(32);
  });
});

describe("content", () => {
  it("round-trips text and bytes, deterministically", async () => {
    const { keys } = await createEncryption("pw", ITER);
    const a = await encryptContent(keys, "# Secret plans\n");
    expect(new TextDecoder().decode(a)).not.toContain("Secret");
    expect(await encryptContent(keys, "# Secret plans\n")).toEqual(a);
    expect(await encryptContent(keys, "# Secret plans!\n")).not.toEqual(a);
    expect(new TextDecoder().decode(await decryptContent(keys, a))).toBe("# Secret plans\n");
    const img = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 1, 2);
    expect(await decryptContent(keys, await encryptContent(keys, img))).toEqual(img);
  });

  it("refuses tampered data or another repository's key", async () => {
    const { keys } = await createEncryption("pw", ITER);
    const other = await createEncryption("pw", ITER);
    const data = await encryptContent(keys, "hello");
    const tampered = data.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptContent(keys, tampered)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptContent(other.keys, data)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptContent(keys, new TextEncoder().encode("plain text"))).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("paths", () => {
  it("hides names in lowercase base32 under encrypted/, and maps them back", async () => {
    const { keys } = await createEncryption("pw", ITER);
    const stored = await encryptPath(keys, "Health/Therapy notes.md");
    expect(stored).toMatch(/^encrypted\/[a-z2-7]+$/);
    expect(stored).not.toMatch(/therapy/i);
    expect(await encryptPath(keys, "Health/Therapy notes.md")).toBe(stored);
    expect(await decryptPath(keys, stored)).toBe("Health/Therapy notes.md");
    expect(await decryptPath(keys, "README.md")).toBeNull();
    expect(await decryptPath(keys, "encrypted/notbase32!")).toBeNull();
  });

  it("splits long names into folders so no name passes 200 characters", async () => {
    const { keys } = await createEncryption("pw", ITER);
    const long = "Projects/" + "a very long folder name/".repeat(12) + "note.md";
    const stored = await encryptPath(keys, long);
    expect(stored.split("/").every((s) => s.length <= 200)).toBe(true);
    expect(stored.split("/").length).toBeGreaterThan(2);
    expect(await decryptPath(keys, stored)).toBe(long);
  });
});

it("base32 round-trips", () => {
  const b = Uint8Array.from({ length: 33 }, (_, i) => i * 7);
  expect(fromBase32(toBase32(b))).toEqual(b);
});
