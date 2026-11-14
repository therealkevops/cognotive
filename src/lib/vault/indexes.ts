import { LinkIndex } from "../links/link-index";
import { NoteIndex } from "../search/note-index";
import { parseDrawing } from "../drawing/parse";
import { isDrawing, isMarkdown } from "./paths";

/** The vault's derived indexes, updated together: keyword search and the link graph. */
export class VaultIndexes {
  readonly search = new NoteIndex();
  readonly links = new LinkIndex();

  /**
   * Indexes a text file. Notes and drawings are parsed and searchable; other
   * files are only known by name (for link resolution).
   */
  set(path: string, content: string): void {
    if (isMarkdown(path)) this.search.set(path, content);
    else if (isDrawing(path)) this.search.set(path, parseDrawing(content).text);
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
