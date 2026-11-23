import {
  decryptContent,
  decryptPath,
  encryptContent,
  encryptPath,
  ENCRYPTED_DIR,
  HEADER_PATH,
  type RepoKeys,
} from "../crypto/repo-crypto";
import { gitBlobSha } from "./hash";
import type { Change, Head, RemoteRepo } from "./remote";

/**
 * A remote whose files are encrypted end to end. The sync engine sees plain
 * paths and content; the wrapped remote (GitHub) only ever gets ciphertext
 * under `encrypted/`, with neutral commit messages. Files outside `encrypted/`
 * are ignored.
 */
export class EncryptedRemote implements RemoteRepo {
  /** git sha of plain content → git sha of its ciphertext. */
  private ids = new Map<string, string>();
  /** stored path → plain path (null: not ours). */
  private names = new Map<string, string | null>();

  constructor(
    private inner: RemoteRepo,
    private keys: RepoKeys,
  ) {}

  head(): Promise<Head | null> {
    return this.inner.head();
  }

  async files(tree: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const raw = [...(await this.inner.files(tree))].filter(([p]) => p.startsWith(ENCRYPTED_DIR + "/"));
    await Promise.all(
      raw.map(async ([stored, sha]) => {
        if (!this.names.has(stored)) this.names.set(stored, await decryptPath(this.keys, stored));
        const plain = this.names.get(stored);
        if (plain) out.set(plain, sha);
      }),
    );
    return out;
  }

  async readBlobBytes(sha: string): Promise<Uint8Array> {
    return decryptContent(this.keys, await this.inner.readBlobBytes(sha));
  }

  async readBlob(sha: string): Promise<string> {
    return new TextDecoder().decode(await this.readBlobBytes(sha));
  }

  async contentId(content: string | Uint8Array): Promise<string> {
    const plain = await gitBlobSha(content);
    let id = this.ids.get(plain);
    if (!id) {
      id = await gitBlobSha(await encryptContent(this.keys, content));
      this.ids.set(plain, id);
    }
    return id;
  }

  async commit(parent: Head | null, changes: Change[]): Promise<Head> {
    const stored = await Promise.all(
      changes.map(async (c) => ({
        path: await this.storedPath(c.path),
        content: c.content === null ? null : await encryptContent(this.keys, c.content),
      })),
    );
    // The engine's message names the notes; that would leak them.
    const n = changes.length;
    return this.inner.commit(parent, stored, `CogNotive.ai: update ${n} ${n === 1 ? "file" : "files"}`);
  }

  /** Where a plain repo path is stored. */
  storedPath(path: string): Promise<string> {
    return encryptPath(this.keys, path);
  }

  /** Decrypts a stored file's bytes, e.g. an old version from history. */
  decrypt(data: Uint8Array): Promise<Uint8Array> {
    return decryptContent(this.keys, data);
  }
}

export class EncryptedRepoError extends Error {
  constructor() {
    super("This GitHub repository is encrypted. Remove it here and connect it again to unlock it.");
  }
}

/**
 * A plain (unencrypted) remote that refuses to sync with an encrypted
 * repository, so notes are never pushed there unencrypted.
 */
export class PlainRemote implements RemoteRepo {
  constructor(private inner: RemoteRepo) {}
  head() {
    return this.inner.head();
  }
  async files(tree: string) {
    const files = await this.inner.files(tree);
    if (files.has(HEADER_PATH)) throw new EncryptedRepoError();
    return files;
  }
  readBlob(sha: string) {
    return this.inner.readBlob(sha);
  }
  readBlobBytes(sha: string) {
    return this.inner.readBlobBytes(sha);
  }
  commit(parent: Head | null, changes: Change[], message: string) {
    return this.inner.commit(parent, changes, message);
  }
}
