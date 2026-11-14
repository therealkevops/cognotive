import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../vault/local-store";
import { conflictPath, isSyncable, mergeText, SyncEngine } from "./engine";
import { FakeRemote } from "./fake-remote";
import { MemorySyncState } from "./state";

let n = 0;
const open: LocalStore[] = [];
afterEach(async () => Promise.all(open.splice(0).map((s) => s.close())));

const DAY = new Date("2026-11-14T10:00:00Z");

async function setup(remoteFiles: Record<string, string | Uint8Array> = {}, folder = "") {
  const remote = new FakeRemote();
  if (Object.keys(remoteFiles).length) await remote.push(remoteFiles);
  const local = new LocalStore(`sync-${n++}`);
  open.push(local);
  const state = new MemorySyncState();
  const engine = new SyncEngine(local, state, remote, folder, () => DAY);
  return { remote, local, state, engine };
}

async function localSnapshot(local: LocalStore) {
  const out: Record<string, string | Uint8Array> = {};
  for (const e of await local.list()) {
    if (e.kind !== "file") continue;
    out[e.path] = (await local.read(e.path))?.content ?? (await local.readBinary(e.path))!;
  }
  return out;
}

describe("isSyncable", () => {
  it("syncs text files and skips hidden folders and binaries", () => {
    expect(isSyncable("Notes/a.md")).toBe(true);
    expect(isSyncable("Drawings/x.excalidraw")).toBe(true);
    expect(isSyncable(".obsidian/app.json")).toBe(false);
    expect(isSyncable(".noted/settings.json")).toBe(true);
    expect(isSyncable("a/.hidden/b.md")).toBe(false);
    expect(isSyncable("attachments/pic.png")).toBe(true);
    expect(isSyncable("tool.exe")).toBe(false);
  });
});

describe("SyncEngine", () => {
  it("clones a repo into an empty vault", async () => {
    const { local, engine, remote } = await setup({
      "Welcome.md": "hi",
      "Projects/Plan.md": "plan",
      ".obsidian/app.json": "{}",
      "tool.exe": "binary",
    });
    const r = await engine.sync();
    expect(await localSnapshot(local)).toEqual({ "Welcome.md": "hi", "Projects/Plan.md": "plan" });
    expect(r.changedLocally.sort()).toEqual(["Projects/Plan.md", "Welcome.md"]);
    expect(r.commit).toBeNull();
    expect(remote.commitCount).toBe(0);
  });

  it("pushes local edits, additions and deletions in one commit", async () => {
    const { local, engine, remote } = await setup({ "a.md": "A", "b.md": "B", "keep.exe": "bin" });
    await engine.sync();
    await local.write("a.md", "A2");
    await local.write("new.md", "N");
    await local.delete("b.md");
    expect(await engine.pendingChanges()).toBe(3);

    const r = await engine.sync();
    expect(remote.commitCount).toBe(1);
    expect(r.pushed.sort()).toEqual(["a.md", "b.md", "new.md"]);
    // Files we don't sync are left alone in the repo.
    expect(remote.snapshot()).toEqual({ "a.md": "A2", "new.md": "N", "keep.exe": "bin" });
    expect(await engine.pendingChanges()).toBe(0);
  });

  it("does nothing when nothing changed", async () => {
    const { engine, remote } = await setup({ "a.md": "A" });
    await engine.sync();
    const r = await engine.sync();
    expect(r).toMatchObject({ changedLocally: [], pushed: [], commit: null });
    expect(remote.commitCount).toBe(0);
  });

  it("pulls remote edits, additions and deletions", async () => {
    const { local, engine, remote } = await setup({ "a.md": "A", "b.md": "B" });
    await engine.sync();
    await remote.push({ "a.md": "A-remote", "b.md": null, "c.md": "C" });
    await engine.sync();
    expect(await localSnapshot(local)).toEqual({ "a.md": "A-remote", "c.md": "C" });
  });

  it("merges edits to different lines of the same note", async () => {
    const { local, engine, remote } = await setup({ "a.md": "one\ntwo\nthree\n" });
    await engine.sync();
    await local.write("a.md", "ONE\ntwo\nthree\n");
    await remote.push({ "a.md": "one\ntwo\nTHREE\n" });
    const r = await engine.sync();
    expect(r.conflicts).toEqual([]);
    expect((await local.read("a.md"))!.content).toBe("ONE\ntwo\nTHREE\n");
    expect(remote.snapshot()["a.md"]).toBe("ONE\ntwo\nTHREE\n");
    expect(await engine.pendingChanges()).toBe(0);
  });

  it("keeps both versions when the same line changed on both sides", async () => {
    const { local, engine, remote } = await setup({ "Notes/a.md": "line\n" });
    await engine.sync();
    await local.write("Notes/a.md", "mine\n");
    await remote.push({ "Notes/a.md": "theirs\n" });
    const r = await engine.sync();
    expect(r.conflicts).toEqual(["Notes/a (conflict 2026-11-14).md"]);
    expect(await localSnapshot(local)).toEqual({
      "Notes/a.md": "theirs\n",
      "Notes/a (conflict 2026-11-14).md": "mine\n",
    });
    expect(remote.snapshot()).toEqual(await localSnapshot(local));
    expect(await engine.pendingChanges()).toBe(0);
  });

  it("treats a note created on both sides with different text as a conflict", async () => {
    const { local, engine, remote } = await setup();
    await engine.sync();
    await local.write("x.md", "local");
    await remote.push({ "x.md": "remote" });
    const r = await engine.sync();
    expect(r.conflicts).toEqual(["x (conflict 2026-11-14).md"]);
  });

  it("lets an edit win over a delete, either way round", async () => {
    const { local, engine, remote } = await setup({ "a.md": "A", "b.md": "B" });
    await engine.sync();
    await local.delete("a.md"); // we delete, they edit
    await remote.push({ "a.md": "A-edited", "b.md": null }); // they delete, we edit
    await local.write("b.md", "B-edited");
    await engine.sync();
    expect(await localSnapshot(local)).toEqual({ "a.md": "A-edited", "b.md": "B-edited" });
    expect(remote.snapshot()).toEqual({ "a.md": "A-edited", "b.md": "B-edited" });
  });

  it("retries when someone pushes between our read and our commit", async () => {
    const { local, engine, remote } = await setup({ "a.md": "A" });
    await engine.sync();
    await local.write("mine.md", "M");
    remote.raceOnNextCommit = new Map([["theirs.md", "T"]]);
    await engine.sync();
    expect(remote.snapshot()).toEqual({ "a.md": "A", "mine.md": "M", "theirs.md": "T" });
    expect(await localSnapshot(local)).toEqual(remote.snapshot());
  });

  it("never overwrites an edit made while the sync was running", async () => {
    const { local, engine, remote } = await setup({ "a.md": "A" });
    await engine.sync();
    await remote.push({ "a.md": "A-remote" });
    // Simulate typing between the sync reading the file and writing it back.
    const realWriteIf = local.writeIf.bind(local);
    local.writeIf = async (path, expected, content) => {
      await local.write("a.md", "typed during sync");
      return realWriteIf(path, expected, content);
    };
    const r = await engine.sync();
    expect(r.deferred).toEqual(["a.md"]);
    expect((await local.read("a.md"))!.content).toBe("typed during sync");
    local.writeIf = realWriteIf;

    // Next sync sees both sides changed: different line → conflict copy, nothing lost.
    const r2 = await engine.sync();
    expect(r2.conflicts).toEqual(["a (conflict 2026-11-14).md"]);
    expect((await local.read("a (conflict 2026-11-14).md"))!.content).toBe("typed during sync");
    expect((await local.read("a.md"))!.content).toBe("A-remote");
  });

  it("syncs only inside the vault folder", async () => {
    const { local, engine, remote } = await setup({ "README.md": "repo readme", "notes/a.md": "A" }, "notes");
    await engine.sync();
    expect(await localSnapshot(local)).toEqual({ "a.md": "A" });
    await local.write("b.md", "B");
    await engine.sync();
    expect(remote.snapshot()).toEqual({ "README.md": "repo readme", "notes/a.md": "A", "notes/b.md": "B" });
  });

  it("makes the first commit in an empty repository", async () => {
    const { local, engine, remote } = await setup();
    await local.write("Welcome.md", "hello");
    await engine.sync();
    expect(remote.snapshot()).toEqual({ "Welcome.md": "hello" });
  });
});

describe("SyncEngine attachments and drawings", () => {
  const png = (n: number) => new Uint8Array([137, 80, 78, 71, n, 0, 255]);

  it("syncs attachments as bytes, both ways", async () => {
    const { local, engine, remote } = await setup({ "attachments/a.png": png(1) });
    await engine.sync();
    expect(await local.readBinary("attachments/a.png")).toEqual(png(1));

    await local.writeBinary("attachments/b.png", png(2));
    await engine.sync();
    expect(remote.snapshot()["attachments/b.png"]).toEqual(png(2));

    await remote.push({ "attachments/a.png": png(3) });
    await engine.sync();
    expect(await local.readBinary("attachments/a.png")).toEqual(png(3));
    expect(await engine.pendingChanges()).toBe(0);
  });

  it("keeps both versions of an attachment changed on both sides", async () => {
    const { local, engine, remote } = await setup({ "pic.png": png(1) });
    await engine.sync();
    await local.writeBinary("pic.png", png(2));
    await remote.push({ "pic.png": png(3) });
    const r = await engine.sync();
    expect(r.conflicts).toEqual(["pic (conflict 2026-11-14).png"]);
    expect(await local.readBinary("pic.png")).toEqual(png(3));
    expect(await local.readBinary("pic (conflict 2026-11-14).png")).toEqual(png(2));
  });

  it("never line-merges drawings: both edited means a conflict copy", async () => {
    const base = '{\n"elements": [\n1\n],\n"x": 1\n}';
    const { local, engine, remote } = await setup({ "d.excalidraw": base });
    await engine.sync();
    await local.write("d.excalidraw", base.replace("1\n]", "1,\n2\n]"));
    await remote.push({ "d.excalidraw": base.replace('"x": 1', '"x": 2') });
    const r = await engine.sync();
    expect(r.conflicts).toEqual(["d (conflict 2026-11-14).excalidraw"]);
  });
});

describe("SyncEngine downloads", () => {
  it("fetches a large first sync in parallel", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`n${i}.md`] = `note ${i}`;
    const { local, engine, remote } = await setup(files);
    let inFlight = 0;
    let peak = 0;
    const read = remote.readBlob.bind(remote);
    remote.readBlob = async (sha) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return read(sha);
    };
    await engine.sync();
    expect((await local.list()).length).toBe(40);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe("mergeText", () => {
  it("returns null on overlapping changes", () => {
    expect(mergeText("a\nX\n", "a\nb\n", "a\nY\n")).toBeNull();
  });
  it("accepts identical changes on both sides", () => {
    expect(mergeText("a\nX\n", "a\nb\n", "a\nX\n")).toBe("a\nX\n");
  });
});

describe("conflictPath", () => {
  it("numbers repeated conflicts on the same day", () => {
    const taken = new Set(["f/n (conflict 2026-11-14).md"]);
    expect(conflictPath("f/n.md", DAY, (p) => taken.has(p))).toBe("f/n (conflict 2026-11-14 2).md");
  });
});
