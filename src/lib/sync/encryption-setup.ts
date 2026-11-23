import { HEADER_PATH, parseHeader, serializeHeader, type EncryptionHeader } from "../crypto/repo-crypto";
import type { RemoteRepo } from "./remote";

export type RepoProbe =
  | { kind: "encrypted"; header: EncryptionHeader }
  /** No notes yet: encryption can be turned on. */
  | { kind: "empty" }
  /** Already holds unencrypted files, which would stay readable in its history. */
  | { kind: "plain" };

/** Files GitHub can add to a new repository; they don't count as content. */
const STARTER_FILES = new Set(["README.md", "LICENSE", "LICENSE.md", ".gitignore", ".gitattributes"]);

/** Whether a repository (branch) is encrypted, empty, or already holds plain files. */
export async function probeRepo(remote: RemoteRepo): Promise<RepoProbe> {
  const head = await remote.head();
  if (!head) return { kind: "empty" };
  const files = await remote.files(head.tree);
  const headerSha = files.get(HEADER_PATH);
  if (headerSha) {
    const header = parseHeader(await remote.readBlob(headerSha));
    if (!header) throw new Error("This repository's encryption settings are damaged or from a newer version.");
    return { kind: "encrypted", header };
  }
  return [...files.keys()].every((p) => STARTER_FILES.has(p)) ? { kind: "empty" } : { kind: "plain" };
}

const README = `# Encrypted notes

This repository holds notes encrypted by CogNotive.ai. File names and contents are
encrypted in the browser before they reach GitHub, so they can't be read here.

To read them, open CogNotive.ai, connect this repository and enter its passphrase or
recovery key. \`.noted/encryption.json\` holds the encryption settings; it
doesn't contain the key.
`;

/** Writes the encryption settings (and a README saying what this is) to the repository. */
export async function writeEncryptionHeader(remote: RemoteRepo, header: EncryptionHeader): Promise<void> {
  const head = await remote.head();
  const files = head ? await remote.files(head.tree) : new Map<string, string>();
  const changes = [{ path: HEADER_PATH, content: serializeHeader(header) }];
  if (!files.has("README.md")) changes.push({ path: "README.md", content: README });
  await remote.commit(head, changes, "CogNotive.ai: turn on encryption");
}
