export interface VaultFile {
  path: string;
  content: string;
  /** Last modification time, ms since epoch. */
  mtime: number;
}

export interface VaultEntry {
  path: string;
  kind: "file" | "folder";
  mtime: number;
}

/**
 * Storage backend for one vault. Implementations: LocalStore (IndexedDB) now,
 * GitHubStore in phase 2. All paths are normalized vault paths (see paths.ts).
 */
export interface VaultStore {
  /** Every file and explicitly created folder, in no particular order. */
  list(): Promise<VaultEntry[]>;
  read(path: string): Promise<VaultFile | undefined>;
  /** Creates or overwrites a file. Parent folders are implied. */
  write(path: string, content: string): Promise<VaultFile>;
  createFolder(path: string): Promise<void>;
  /** Deletes a file, or a folder and everything in it. */
  delete(path: string): Promise<void>;
  /** Renames or moves a file or folder (with its contents). Fails if `to` exists. */
  rename(from: string, to: string): Promise<void>;
}
