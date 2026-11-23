import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createEncryption, HEADER_PATH, serializeHeader, unlockWithPassphrase } from "../crypto/repo-crypto";
import { LocalStore } from "../vault/local-store";
import { EncryptedRemote, EncryptedRepoError, PlainRemote } from "./encrypted-remote";
import { SyncEngine } from "./engine";
import { FakeRemote } from "./fake-remote";
import type { Change, Head } from "./remote";
import { MemorySyncState } from "./state";

let n = 0;
const open: LocalStore[] = [];
afterEach(async () => Promise.all(open.splice(0).map((s) => s.close())));

const DAY = new Date("2026-11-14T10:00:00Z");

async function encryptedRepo() {
  const github = new FakeRemote();
  const { header, keys } = await createEncryption("hunter2", 1000);
  await github.push({ [HEADER_PATH]: serializeHeader(header) });
  return { github, header, keys };
}

function device(github: FakeRemote, keys: Awaited<ReturnType<typeof encryptedRepo>>["keys"], folder = "") {
  const local = new LocalStore(`enc-${n++}`);
  open.push(local);
  const engine = new SyncEngine(local, new MemorySyncState(), new EncryptedRemote(github, keys), folder, () => DAY);
  return { local, engine };
}

/** Everything GitHub holds, as text, to check nothing readable got there. */
function stored(github: FakeRemote): string {
  return Object.entries(github.snapshot())
    .map(([p, c]) => `${p}\n${typeof c === "string" ? c : new TextDecoder().decode(c)}`)
    .join("\n");
}

describe("EncryptedRemote", () => {
  it("pushes only ciphertext, hides names, and a second device reads it back", async () => {
    const { github, header } = await encryptedRepo();
    const keys = await unlockWithPassphrase(header, "hunter2");
    const a = device(github, keys);
    await a.local.write("Health/Therapy notes.md", "Talked about the move.");
    await a.local.writeBinary("attachments/scan.png", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
    const r = await a.engine.sync();
    expect(r.pushed.sort()).toEqual(["Health/Therapy notes.md", "attachments/scan.png"]);

    const text = stored(github);
    expect(text).not.toMatch(/therapy|health|move|scan|attachments/i);
    const paths = Object.keys(github.snapshot()).sort();
    expect(paths[0]).toBe(HEADER_PATH);
    expect(paths.slice(1).every((p) => /^encrypted\/[a-z2-7]+$/.test(p))).toBe(true);

    const b = device(github, await unlockWithPassphrase(header, "hunter2"));
    await b.engine.sync();
    expect((await b.local.read("Health/Therapy notes.md"))?.content).toBe("Talked about the move.");
    expect(await b.local.readBinary("attachments/scan.png")).toEqual(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
  });

  it("an unchanged repo syncs with nothing to do", async () => {
    const { github, keys } = await encryptedRepo();
    const a = device(github, keys);
    await a.local.write("Note.md", "hello");
    await a.engine.sync();
    const commits = github.commitCount;
    const again = await a.engine.sync();
    expect(again.pushed).toEqual([]);
    expect(again.changedLocally).toEqual([]);
    expect(github.commitCount).toBe(commits);
    expect(await a.engine.pendingChanges()).toBe(0);
  });

  it("merges edits from two devices line by line, using old versions from GitHub", async () => {
    const { github, keys } = await encryptedRepo();
    const a = device(github, keys);
    const b = device(github, keys);
    await a.local.write("Plan.md", "one\ntwo\nthree\n");
    await a.engine.sync();
    await b.engine.sync();

    await a.local.write("Plan.md", "ONE\ntwo\nthree\n");
    await a.engine.sync();
    await b.local.write("Plan.md", "one\ntwo\nTHREE\n");
    const r = await b.engine.sync();
    expect(r.conflicts).toEqual([]);
    expect((await b.local.read("Plan.md"))?.content).toBe("ONE\ntwo\nTHREE\n");
    await a.engine.sync();
    expect((await a.local.read("Plan.md"))?.content).toBe("ONE\ntwo\nTHREE\n");
  });

  it("reports a conflict, with both versions, when the same line changed on both devices", async () => {
    const { github, keys } = await encryptedRepo();
    const a = device(github, keys);
    const b = device(github, keys);
    await a.local.write("Note.md", "hello\n");
    await a.engine.sync();
    await b.engine.sync();
    await a.local.write("Note.md", "hello from a\n");
    await a.engine.sync();
    await b.local.write("Note.md", "hello from b\n");
    const r = await b.engine.sync();
    expect(r.conflicts).toMatchObject([{ path: "Note.md", ours: "hello from b\n", theirs: "hello from a\n", base: "hello\n" }]);
    expect((await b.local.read("Note.md"))?.content).toBe("hello from a\n");
  });

  it("renames and deletes reach the other device", async () => {
    const { github, keys } = await encryptedRepo();
    const a = device(github, keys);
    const b = device(github, keys);
    await a.local.write("Old name.md", "x");
    await a.engine.sync();
    await b.engine.sync();
    await a.local.rename("Old name.md", "New name.md");
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.local.read("Old name.md")).toBeUndefined();
    expect((await b.local.read("New name.md"))?.content).toBe("x");
    expect(Object.keys(github.snapshot())).toHaveLength(2); // the header and one note
  });

  it("works inside a repo subfolder, and ignores plain files others put in the repo", async () => {
    const { github, keys } = await encryptedRepo();
    await github.push({ "README.md": "# My notes" });
    const a = device(github, keys, "notes");
    await a.local.write("A.md", "secret");
    await a.engine.sync();
    expect(stored(github)).not.toContain("notes/A");
    const b = device(github, keys, "notes");
    await b.engine.sync();
    expect((await b.local.read("A.md"))?.content).toBe("secret");
    expect(await b.local.read("README.md")).toBeUndefined();
  });

  it("commit messages don't name notes", async () => {
    const { github, keys } = await encryptedRepo();
    const messages: string[] = [];
    const commit = github.commit.bind(github);
    github.commit = (parent: Head | null, changes: Change[], message?: string) => {
      messages.push(message ?? "");
      return commit(parent, changes);
    };
    const a = device(github, keys);
    await a.local.write("Secret project.md", "x");
    await a.engine.sync();
    expect(messages).toEqual(["Cognotive.ai: update 1 file"]);
  });
});

describe("PlainRemote", () => {
  it("refuses to sync an encrypted repository without the key", async () => {
    const { github } = await encryptedRepo();
    const local = new LocalStore(`enc-${n++}`);
    open.push(local);
    await local.write("Note.md", "would leak");
    const engine = new SyncEngine(local, new MemorySyncState(), new PlainRemote(github), "");
    await expect(engine.sync()).rejects.toBeInstanceOf(EncryptedRepoError);
    expect(stored(github)).not.toContain("would leak");
  });
});
