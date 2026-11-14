/** Git's blob id: SHA-1 of "blob <byte length>\0<content>". Lets us compare with GitHub without downloading. */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
