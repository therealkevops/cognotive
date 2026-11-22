import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StoredNote, VectorStore } from "./semantic-index";

interface SemanticDB extends DBSchema {
  notes: { key: string; value: StoredNote };
}

/** Vectors for one repository, in this browser only (they're rebuilt from the notes anywhere else). */
export function idbVectorStore(vaultId: string): VectorStore {
  let db_: Promise<IDBPDatabase<SemanticDB>> | null = null;
  const db = () =>
    (db_ ??= openDB<SemanticDB>(`noted-ai:semantic:${vaultId}`, 1, {
      upgrade(d) {
        d.createObjectStore("notes");
      },
    }));
  return {
    async all() {
      const d = await db();
      const tx = d.transaction("notes");
      const out = new Map<string, StoredNote>();
      for (let c = await tx.store.openCursor(); c; c = await c.continue()) out.set(String(c.key), c.value);
      return out;
    },
    put: async (path, note) => void (await (await db()).put("notes", note, path)),
    delete: async (path) => void (await (await db()).delete("notes", path)),
    clear: async () => void (await (await db()).clear("notes")),
  };
}
