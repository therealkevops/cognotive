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
 * Storage backend for one vault: LocalStore (IndexedDB), which GitHub vaults
 * also use as their working copy. All paths are normalized vault paths (see
 * paths.ts). Text files (notes, drawings) use read/write; attachments (images,
 * PDFs) use readBinary/writeBinary.
 */
export interface VaultStore {
  /** Every file and explicitly created folder, in no particular order. */
  list(): Promise<VaultEntry[]>;
  read(path: string): Promise<VaultFile | undefined>;
  /** Creates or overwrites a file. Parent folders are implied. */
  write(path: string, content: string): Promise<VaultFile>;
  readBinary(path: string): Promise<Uint8Array | undefined>;
  writeBinary(path: string, bytes: Uint8Array): Promise<VaultEntry>;
  createFolder(path: string): Promise<void>;
  /** Deletes a file, or a folder and everything in it. */
  delete(path: string): Promise<void>;
  /** Renames or moves a file or folder (with its contents). Fails if `to` exists. */
  rename(from: string, to: string): Promise<void>;
  /** Calls `listener` with the changed paths after each saved change; returns a stop function. */
  onChange?(listener: (paths: string[]) => void): () => void;
}
