"use client";

import { FilePlus2, LayoutTemplate, Pencil, TextCursorInput } from "lucide-react";
import { useMemo, useState } from "react";
import {
  fillName,
  noteFromTemplate,
  renderTemplate,
  STARTER_TEMPLATES,
  templateInputs,
  templateSettings,
} from "@/lib/templates/templates";
import { isNote, isWithin, joinPath, noteTitle, uniquePath } from "@/lib/vault/paths";
import { useVault, type VaultApi } from "../vault/useVault";
import { Modal } from "./Modal";

/** The templates folder, or "Templates" when the setting is empty. */
export const templateFolderOf = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, "") || "Templates";

/** Notes in the templates folder, sorted by name. */
export function useTemplatePaths(): string[] {
  const vault = useVault();
  const folder = templateFolderOf(vault.settings.templateFolder);
  return useMemo(
    () =>
      vault.indexed.links
        .paths()
        .filter((p) => isNote(p) && isWithin(p, folder))
        .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b))),
    [vault.indexed, folder],
  );
}

/**
 * Adds the starter templates that aren't there yet, and makes Daily the daily
 * note template if none is set. Returns how many were added.
 */
export async function addStarterTemplates(vault: VaultApi): Promise<number> {
  const folder = templateFolderOf(vault.settings.templateFolder);
  let added = 0;
  for (const [name, content] of Object.entries(STARTER_TEMPLATES)) {
    const path = joinPath(folder, name);
    if (vault.exists(path)) continue;
    await vault.writeNote(path, content);
    added++;
  }
  if (!vault.settings.dailyTemplate) await vault.updateSettings({ dailyTemplate: joinPath(folder, "Daily.md") });
  return added;
}

const NEW_TEMPLATE = `---
template-folder: 
template-name: 
tags: []
---
# {{title}}

Created {{date}}. {{cursor}}
`;

/** The Templates tab: every template, to start a note from, insert, or edit. */
export function TemplatesPanel({
  onUse,
  canInsert,
}: {
  onUse(path: string, mode: "new" | "insert"): void;
  canInsert: boolean;
}) {
  const vault = useVault();
  const templates = useTemplatePaths();
  const folder = templateFolderOf(vault.settings.templateFolder);
  const [adding, setAdding] = useState(false);

  return (
    <section aria-label="Templates" className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="flex-1 text-xs font-medium text-muted">Templates</h2>
        <button
          type="button"
          className="icon-button h-7 w-7"
          aria-label="New template"
          title="New template"
          onClick={() =>
            void vault.createNoteWith(uniquePath(joinPath(folder, "New template.md"), vault.exists), NEW_TEMPLATE)
          }
        >
          <FilePlus2 size={15} aria-hidden />
        </button>
      </div>
      {templates.length === 0 ? (
        <div className="space-y-3 text-sm text-muted">
          <p>
            Templates are notes in the <strong>{folder}</strong> folder. Start a note from one to get its headings,
            properties and prompts filled in.
          </p>
          <button
            type="button"
            className="button-secondary"
            disabled={adding}
            onClick={() => {
              setAdding(true);
              void addStarterTemplates(vault).finally(() => setAdding(false));
            }}
          >
            Add starter templates
          </button>
        </div>
      ) : (
        <ul className="-mx-2 flex-1 overflow-y-auto">
          {templates.map((p) => {
            const target = templateSettings(vault.links.content(p) ?? "").folder;
            return (
              <li key={p} className="group flex items-center gap-1 rounded-lg px-2 hover:bg-foreground/[0.05]">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
                  title={`New note from “${noteTitle(p)}”`}
                  aria-label={`New note from ${noteTitle(p)}`}
                  onClick={() => onUse(p, "new")}
                >
                  <LayoutTemplate size={15} aria-hidden className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{noteTitle(p)}</span>
                  {target && <span className="shrink-0 truncate text-xs text-muted">{target}</span>}
                </button>
                {canInsert && (
                  <button
                    type="button"
                    className="icon-button h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Insert ${noteTitle(p)} here`}
                    title="Insert into the open note"
                    onClick={() => onUse(p, "insert")}
                  >
                    <TextCursorInput size={14} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Edit ${noteTitle(p)}`}
                  title="Edit the template"
                  onClick={() => void vault.open(p)}
                >
                  <Pencil size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Fields: {"{{title}}"}, {"{{date}}"}, {"{{time}}"}, {"{{folder}}"}, {"{{cursor}}"}, {"{{input:Question}}"}.
        Properties <code>template-folder</code> and <code>template-name</code> set where new notes go and their name.
      </p>
    </section>
  );
}

/**
 * Uses a template: asks for its prompts (and, for a new note, the name and
 * folder), then creates the note or inserts into the open one.
 */
export function UseTemplateDialog({
  path,
  mode,
  defaultFolder,
  onInsert,
  onCreating,
  onClose,
}: {
  path: string;
  mode: "new" | "insert";
  /** Where a new note goes when the template doesn't say. */
  defaultFolder: string;
  onInsert(rendered: ReturnType<typeof renderTemplate>): void;
  /** Called just before the note is created, with where the cursor goes, counted from the end of the note. */
  onCreating(path: string, cursorFromEnd: number): void;
  onClose(): void;
}) {
  const vault = useVault();
  const text = vault.links.content(path) ?? "";
  const settings = templateSettings(text);
  const inputs = useMemo(() => templateInputs((settings.name ?? "") + "\n" + text), [settings.name, text]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((i) => [i.label, i.default])),
  );
  const [folder, setFolder] = useState(settings.folder ?? defaultFolder);
  const [now] = useState(() => new Date());
  const suggested = settings.name ? fillName(settings.name, { now, folder, inputs: values }) : "";
  const [name, setName] = useState<string | null>(null); // null: follow the suggestion
  const finalName = (name ?? suggested).trim();

  const submit = async () => {
    const ctx = { title: finalName, now, folder, inputs: values };
    if (mode === "insert") {
      onInsert(renderTemplate(text, { ...ctx, title: noteTitle(vault.active?.path ?? "") }));
      onClose();
      return;
    }
    if (!finalName) return;
    const target = uniquePath(joinPath(folder.trim().replace(/^\/+|\/+$/g, ""), `${finalName}.md`), vault.exists);
    const note = noteFromTemplate(renderTemplate(text, { ...ctx, title: noteTitle(target) }));
    onClose();
    onCreating(target, note.content.length - note.cursor);
    await vault.createNoteWith(target, note.content);
  };

  return (
    <Modal label={mode === "new" ? `New note from ${noteTitle(path)}` : `Insert ${noteTitle(path)}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "new" && (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                className="input w-full"
                value={name ?? suggested}
                placeholder="Note name"
                autoFocus={inputs.length === 0 || !!settings.name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Folder</span>
              <input
                className="input w-full"
                value={folder}
                placeholder="Repository root"
                onChange={(e) => setFolder(e.target.value)}
              />
            </label>
          </>
        )}
        {inputs.map((i, n) => (
          <label key={i.label} className="block text-sm">
            <span className="mb-1 block font-medium">{i.label}</span>
            <input
              className="input w-full"
              value={values[i.label] ?? ""}
              autoFocus={n === 0 && (mode === "insert" || !settings.name)}
              onChange={(e) => setValues((v) => ({ ...v, [i.label]: e.target.value }))}
            />
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={mode === "new" && !finalName}>
            {mode === "new" ? "Create note" : "Insert"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Whether using this template needs the dialog (prompts to answer). Inserting without prompts doesn't. */
export const needsDialog = (vault: VaultApi, path: string, mode: "new" | "insert") =>
  mode === "new" || templateInputs(vault.links.content(path) ?? "").length > 0;
