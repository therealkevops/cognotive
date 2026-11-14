import { basename, dirname, extname, isMarkdown, normalizePath } from "../vault/paths";

/**
 * Resolves link targets to vault paths the way Obsidian does:
 * - "Folder/Note" matches a file whose path ends with that (".md" optional)
 * - "Note" matches by file name, case-insensitively
 * - several matches: prefer the linking note's folder, then the shortest path
 */
export class Resolver {
  /** lower-case basename without .md → paths */
  private byName = new Map<string, string[]>();
  private paths = new Set<string>();

  constructor(paths: Iterable<string> = []) {
    for (const p of paths) this.add(p);
  }

  add(path: string): void {
    if (this.paths.has(path)) return;
    this.paths.add(path);
    const key = Resolver.key(basename(path));
    const list = this.byName.get(key) ?? [];
    list.push(path);
    this.byName.set(key, list);
  }

  remove(path: string): void {
    if (!this.paths.delete(path)) return;
    const key = Resolver.key(basename(path));
    const list = (this.byName.get(key) ?? []).filter((p) => p !== path);
    if (list.length) this.byName.set(key, list);
    else this.byName.delete(key);
  }

  list(): string[] {
    return [...this.paths];
  }

  private static key(name: string): string {
    return (isMarkdown(name) ? name.slice(0, -3) : name).toLowerCase();
  }

  resolve(target: string, from?: string): string | null {
    let t: string;
    try {
      t = normalizePath(target);
    } catch {
      return null;
    }
    if (!t) return from ?? null; // "[[#Heading]]" links within the note
    const name = basename(t);
    const candidates = this.byName.get(Resolver.key(name)) ?? [];
    let matches = candidates;
    if (t.includes("/")) {
      const want = (isMarkdown(t) || extname(t) ? t : `${t}.md`).toLowerCase();
      matches = candidates.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
    } else if (extname(t) && !isMarkdown(t)) {
      matches = candidates.filter((p) => basename(p).toLowerCase() === name.toLowerCase());
    } else {
      // A bare name means a note unless only another file type has that exact name.
      const notes = candidates.filter(isMarkdown);
      matches = notes.length ? notes : candidates.filter((p) => basename(p).toLowerCase() === name.toLowerCase());
    }
    if (matches.length <= 1) return matches[0] ?? null;
    const folder = from ? dirname(from) : null;
    return (
      matches.find((p) => dirname(p) === folder) ??
      [...matches].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0]
    );
  }

  /**
   * The shortest link text that resolves to `path` from anywhere: the bare name
   * when unique, otherwise the path (without ".md").
   */
  linkText(path: string): string {
    const name = basename(path);
    const bare = isMarkdown(name) ? name.slice(0, -3) : name;
    const unique = (this.byName.get(Resolver.key(name)) ?? []).length <= 1;
    if (unique) return bare;
    return isMarkdown(path) ? path.slice(0, -3) : path;
  }
}
