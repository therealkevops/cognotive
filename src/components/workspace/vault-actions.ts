import { backupPrefs } from "@/lib/storage-safety";
import { appendCapture, captureEntry, captureTime, type Captured } from "@/lib/capture/capture";
import { serializeCanvas } from "@/lib/canvas/format";
import { neighbourhoodCanvas, type Neighbour } from "@/lib/canvas/map";
import { formatLink } from "@/lib/links/format";
import { noteFromTemplate, renderTemplate } from "@/lib/templates/templates";
import { deletePropertyIn, renamePropertyIn } from "@/lib/vault/property-ops";
import { formatDate } from "@/lib/vault/settings";
import { basename, dirname, isCanvas, isDrawing, isNote, joinPath, noteTitle } from "@/lib/vault/paths";
import type { VaultApi } from "../vault/useVault";

/* Actions on the whole repository, used by the workspace's commands and panels. */

/** A day's daily note: where it is, and (if it doesn't exist yet) what it starts as, from the template. */
export function dailyNote(vault: VaultApi, date = new Date()) {
  const s = vault.settings;
  const name = formatDate(date, s.dailyFormat || "YYYY-MM-DD");
  const path = joinPath(s.dailyFolder, `${name}.md`);
  let content = "";
  let cursor: number | null = null;
  if (s.dailyTemplate && !vault.exists(path)) {
    const t = vault.links.resolve(s.dailyTemplate.replace(/\.md$/i, ""));
    if (t) {
      const note = noteFromTemplate(
        renderTemplate(vault.links.content(t) ?? "", { title: basename(name), now: date, folder: s.dailyFolder, inputs: {} }),
      );
      content = note.content;
      cursor = note.cursor;
    }
  }
  return { path, name, content, cursor };
}

/** Where quick capture adds an item: the inbox note, or today's daily note. */
export function captureTarget(vault: VaultApi) {
  const s = vault.settings;
  if (s.captureTo === "inbox") {
    const path = /\.md$/i.test(s.captureInbox) ? s.captureInbox : `${s.captureInbox}.md`;
    return { path, start: `# ${noteTitle(path)}\n`, label: noteTitle(path) };
  }
  const d = dailyNote(vault);
  return { path: d.path, start: d.content, label: `today's note (${d.name})` };
}

/** Adds a captured item (and its files, as attachments) to the capture target. Returns the note's path. */
export async function saveCapture(vault: VaultApi, c: Captured, files: File[]): Promise<string> {
  const target = captureTarget(vault);
  const paths = files.length ? await vault.addAttachments(files) : [];
  const embeds = paths.map((p) => {
    const t = vault.links.linkText(p);
    return formatLink(vault.settings.linkFormat, target.path, { path: p, target: t, embed: true }, t);
  });
  const entry = captureEntry({ ...c, embeds }, captureTime());
  if (vault.exists(target.path)) await vault.writeFile(target.path, appendCapture(vault.textOf(target.path) ?? "", entry));
  else await vault.writeFile(target.path, appendCapture(target.start, entry));
  return target.path;
}

const isAttachment = (path: string) => !isNote(path) && !isDrawing(path) && !isCanvas(path);
const latestText = (vault: VaultApi, path: string) => vault.textOf(path) ?? "";

/** Renames a property in every file that has it (not where the new name is already taken). */
export async function renamePropertyEverywhere(vault: VaultApi, from: string, to: string) {
  let changed = 0;
  let clashes = 0;
  for (const path of vault.links.paths()) {
    const props = vault.links.get(path)?.properties ?? {};
    if (!(from in props)) continue;
    if (isAttachment(path)) {
      if (to in props) {
        clashes++;
        continue;
      }
      await vault.setFileProperty(path, to, props[from]);
      await vault.setFileProperty(path, from, undefined);
      changed++;
      continue;
    }
    const next = renamePropertyIn(path, latestText(vault, path), from, to);
    if (next === "clash") clashes++;
    else if (next !== "unchanged") {
      await vault.writeFile(path, next);
      changed++;
    }
  }
  return { changed, clashes };
}

/** Removes a property from every file that has it. */
export async function deletePropertyEverywhere(vault: VaultApi, key: string) {
  let changed = 0;
  for (const path of vault.links.paths()) {
    const props = vault.links.get(path)?.properties ?? {};
    if (!(key in props)) continue;
    if (isAttachment(path)) {
      await vault.setFileProperty(path, key, undefined);
      changed++;
      continue;
    }
    const next = deletePropertyIn(path, latestText(vault, path), key);
    if (next !== "unchanged") {
      await vault.writeFile(path, next);
      changed++;
    }
  }
  return changed;
}

/** Downloads the whole repository as a zip named after it and today's date. */
export async function exportZip(vault: VaultApi, name: string) {
  const bytes = await vault.exportZip();
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]/g, "-")} ${formatDate(new Date(), "YYYY-MM-DD")}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  backupPrefs.markBackup(vault.vaultId);
}

/** Adds the files in a zip to the repository. Returns a sentence saying what happened. */
export async function importZip(vault: VaultApi, file: File): Promise<string> {
  const { readZip } = await import("@/lib/vault/zip");
  const files = readZip(new Uint8Array(await file.arrayBuffer()));
  const r = await vault.importFiles(files);
  return (
    `Imported ${r.added} ${r.added === 1 ? "file" : "files"}` +
      (r.renamed ? `, ${r.renamed} renamed because a different file had the same name` : "") +
      (r.skipped ? `, ${r.skipped} already here` : "") +
      "."
  );
}

/**
 * Makes a canvas of the open note and what's connected to it: typed
 * relations first, then mutual links, links out and links in (up to 16),
 * saved as "<note> map.canvas" next to the note and opened.
 */
export async function mapAsCanvas(vault: VaultApi, center: string) {
  const found = new Map<string, Neighbour>();
  const add = (path: string, direction: "out" | "in", label?: string) => {
    if (path === center) return;
    const prev = found.get(path);
    if (!prev) found.set(path, { path, direction, ...(label ? { label } : {}) });
    else {
      if (prev.direction !== direction) prev.direction = "both";
      if (label && !prev.label) prev.label = label;
    }
  };
  for (const r of vault.links.canvasRelations(center)) if (r.resolved) add(r.other, r.direction, r.label);
  for (const o of vault.links.outgoing(center)) if (o.resolved) add(o.resolved, "out");
  for (const b of vault.links.backlinks(center)) if (!isCanvas(b.source)) add(b.source, "in");
  const rank = (n: Neighbour) => (n.label ? 0 : n.direction === "both" ? 1 : n.direction === "out" ? 2 : 3);
  const neighbours = [...found.values()].sort((a, b) => rank(a) - rank(b)).slice(0, 16);
  const data = neighbourhoodCanvas(center, neighbours);
  const base = joinPath(dirname(center), `${noteTitle(center)} map`);
  let path = `${base}.canvas`;
  for (let i = 2; vault.exists(path); i++) path = `${base} ${i}.canvas`;
  await vault.createNoteWith(path, serializeCanvas(data));
}
