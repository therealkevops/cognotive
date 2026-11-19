import fs from "node:fs";
import path from "node:path";
import { LinkIndex } from "../../src/lib/links/link-index";
import { NoteIndex } from "../../src/lib/search/note-index";
import { isBinary, isNote } from "../../src/lib/vault/paths";

/**
 * A folder of notes on disk (a clone of the repository), indexed the way the
 * app indexes it. Rescanned before each use, rereading only files that changed.
 */
export class NoteFolder {
  readonly links = new LinkIndex();
  readonly search = new NoteIndex();
  private seen = new Map<string, number>();

  constructor(readonly root: string) {}

  /** Repository paths ("Projects/Plan.md") from the folder, skipping hidden folders (except .noted) and node_modules. */
  private walk(dir = "", out: Array<{ path: string; mtime: number }> = []) {
    for (const e of fs.readdirSync(path.join(this.root, dir), { withFileTypes: true })) {
      if ((e.name.startsWith(".") && e.name !== ".noted") || e.name === "node_modules") continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) this.walk(rel, out);
      else if (e.isFile()) out.push({ path: rel, mtime: fs.statSync(path.join(this.root, rel)).mtimeMs });
    }
    return out;
  }

  scan(): this {
    const now = new Map(this.walk().map((f) => [f.path, f.mtime]));
    for (const p of this.seen.keys()) {
      if (!now.has(p)) {
        this.links.remove(p);
        this.search.remove(p);
      }
    }
    for (const [p, mtime] of now) {
      if (this.seen.get(p) === mtime) continue;
      if (p.startsWith(".noted/")) continue;
      if (isBinary(p)) this.links.addFile(p);
      else {
        const text = fs.readFileSync(path.join(this.root, p), "utf8");
        this.links.set(p, text);
        if (isNote(p)) this.search.set(p, text);
      }
    }
    this.seen = now;
    return this;
  }

  files = () => [...this.seen.keys()];
  mtime = (p: string) => this.seen.get(p);

  private abs(p: string): string {
    const full = path.resolve(this.root, p);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`"${p}" is outside the notes folder.`);
    return full;
  }

  read(p: string): string | undefined {
    try {
      return fs.readFileSync(this.abs(p), "utf8");
    } catch {
      return undefined;
    }
  }

  exists = (p: string) => fs.existsSync(this.abs(p));

  write(p: string, text: string) {
    const full = this.abs(p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    this.scan();
  }
}
