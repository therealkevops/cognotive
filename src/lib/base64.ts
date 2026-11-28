/** Base64 for bytes and UTF-8 text (GitHub blobs, encryption headers). */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  // In slices, so large files don't overflow the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const utf8ToBase64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));
export const base64ToUtf8 = (b64: string) => new TextDecoder().decode(base64ToBytes(b64));
