import { LinkIndex } from "../links/link-index";
import { NoteIndex } from "../search/note-index";
import { drawingJson } from "../drawing/obsidian";
import { parseDrawing } from "../drawing/parse";
import { isDrawing, isNote } from "./paths";

/** The vault's derived indexes, updated together: keyword search and the link graph. */
export class VaultIndexes {
  readonly search = new NoteIndex();
  readonly links = new LinkIndex();

  /**
   * Indexes a text file. Notes and drawings are parsed and searchable; other
   * files are only known by name (for link resolution).
   */
  set(path: string, content: string): void {
    if (isDrawing(path)) this.search.set(path, parseDrawing(drawingJson(path, content)).text);
    else if (isNote(path)) this.search.set(path, content);
    this.links.set(path, content);
  }

  addFile(path: string): void {
    this.links.addFile(path);
  }

  remove(path: string): void {
    this.search.remove(path);
    this.links.remove(path);
  }

  clear(): void {
    this.search.clear();
    this.links.clear();
  }
}
