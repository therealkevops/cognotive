import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { diff3Merge } from "node-diff3";
import type { SyncConflict } from "./engine";

/**
 * Conflicts found by sync, kept on this device until they're resolved. The
 * file itself holds the remote's version of the clashing part; the record
 * keeps what was here, so nothing is lost and no copy file is made.
 */
export interface ConflictRecord extends SyncConflict {
  id: string;
}

interface ConflictDB extends DBSchema {
  conflicts: { key: string; value: ConflictRecord };
}

export function conflictDbName(vaultId: string) {
  return `noted-ai:conflicts:${vaultId}`;
}

export class ConflictStore {
  private db_: Promise<IDBPDatabase<ConflictDB>> | null = null;
  constructor(readonly vaultId: string) {}

  private get db() {
    this.db_ ??= openDB<ConflictDB>(conflictDbName(this.vaultId), 1, {
      upgrade(db) {
        db.createObjectStore("conflicts", { keyPath: "id" });
      },
    });
    return this.db_;
  }

  async list(): Promise<ConflictRecord[]> {
    return (await (await this.db).getAll("conflicts")).sort((a, b) => a.at - b.at);
  }

  async add(conflicts: SyncConflict[]): Promise<void> {
    const db = await this.db;
    for (const c of conflicts) await db.put("conflicts", { ...c, id: `${c.at}-${Math.random().toString(36).slice(2, 10)}` });
  }

  async remove(id: string): Promise<void> {
    await (await this.db).delete("conflicts", id);
  }

  /** A file was renamed: its conflicts follow it. */
  async rename(from: string, to: string): Promise<void> {
    const db = await this.db;
    for (const c of await db.getAll("conflicts")) if (c.path === from) await db.put("conflicts", { ...c, path: to });
  }
}

/** Part of a note under review: unchanged lines, or a place where both sides changed the same lines. */
export type ReviewBlock =
  | { kind: "same"; lines: string[] }
  | { kind: "conflict"; yours: string[]; current: string[] };

/**
 * Where the note as it is now (`current`: the remote's lines in the clashing
 * places, plus everything else from both sides) still differs from what was
 * here (`record.ours`) in the places both changed. Edits merged without
 * trouble show as unchanged. Empty of conflicts once they've all been settled
 * (by hand, say).
 */
export function reviewBlocks(record: Pick<SyncConflict, "ours" | "base">, current: string): ReviewBlock[] {
  const ours = typeof record.ours === "string" ? record.ours : "";
  const sep = "\n";
  const blocks: ReviewBlock[] = [];
  for (const b of diff3Merge(ours.split(sep), (record.base ?? "").split(sep), current.split(sep), { stringSeparator: sep })) {
    if (b.ok) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "same") last.lines.push(...b.ok);
      else blocks.push({ kind: "same", lines: [...b.ok] });
    } else if (b.conflict) {
      blocks.push({ kind: "conflict", yours: b.conflict.a, current: b.conflict.b });
    }
  }
  return blocks;
}

export type Choice = "current" | "yours" | "both";

/** The note with each conflict settled as chosen (`choices` in order of the conflicts). */
export function resolveBlocks(blocks: ReviewBlock[], choices: Choice[]): string {
  let i = 0;
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === "same") lines.push(...b.lines);
    else {
      const c = choices[i++] ?? "current";
      if (c === "yours" || c === "both") lines.push(...b.yours);
      if (c === "current" || c === "both") lines.push(...b.current);
    }
  }
  return lines.join("\n");
}
