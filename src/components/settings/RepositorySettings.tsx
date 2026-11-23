"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { formatDate, type VaultSettings } from "@/lib/vault/settings";
import { Group, Row, SectionHeader, Switch, TextSetting } from "./parts";
import { KNOWN_PROPERTIES, PROPERTY_NAME, withNewNoteProperties } from "@/lib/vault/new-note-properties";
import { useVault } from "../vault/useVault";


/* Settings of the open repository. */

/** Which properties every new note starts with: the ones Cognotive.ai understands, plus your own. */
export function NewNoteProperties({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const known = new Set(KNOWN_PROPERTIES.map((p) => p.key));
  const toggle = (key: string, on: boolean) => onChange(on ? [...value, key] : value.filter((k) => k !== key));
  const add = () => {
    const key = custom.trim();
    if (!key) return;
    if (!PROPERTY_NAME.test(key)) return setError("Use letters, numbers, - and _, starting with a letter.");
    if (value.includes(key)) return setError("Already added.");
    onChange([...value, key]);
    setCustom("");
    setError(null);
  };
  const preview = withNewNoteProperties("", value);
  return (
    <div className="py-3">
      <p className="mb-3 text-sm text-muted">
        Every new note starts with these, so you don&apos;t have to remember them. Notes made from a template keep the
        template&apos;s own values.
      </p>
      <ul className="mb-3 grid gap-1.5 sm:grid-cols-2">
        {KNOWN_PROPERTIES.map((p) => (
          <li key={p.key}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={value.includes(p.key)}
                onChange={(e) => toggle(p.key, e.target.checked)}
              />
              <span>
                <code className="text-[0.85em]">{p.key}</code>
                <span className="block text-xs text-muted">{p.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {value.some((k) => !known.has(k)) && (
        <ul aria-label="Your properties" className="mb-3 flex flex-wrap gap-1.5">
          {value
            .filter((k) => !known.has(k))
            .map((k) => (
              <li key={k} className="flex items-center gap-1 rounded-full bg-foreground/[0.06] py-0.5 pr-1 pl-2.5 text-sm">
                <code className="text-[0.85em]">{k}</code>
                <button type="button" className="icon-button h-5 w-5" aria-label={`Remove ${k}`} onClick={() => toggle(k, false)}>
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Add a property
        </label>
        <input
          id={inputId}
          className="input min-w-0 flex-1"
          placeholder="Add your own, e.g. status"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="button-secondary" disabled={!custom.trim()}>
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[#c2412d]">
          {error}
        </p>
      )}
      {preview && (
        <pre aria-label="New notes start with" className="mt-3 rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs text-muted">
          {preview.trimEnd()}
        </pre>
      )}
    </div>
  );
}

export function ThisVaultSection() {
  const { settings, updateSettings } = useVault();
  const save = (patch: Partial<VaultSettings>) => void updateSettings(patch);
  const ids = {
    attachments: useId(),
    templates: useId(),
    dailyFolder: useId(),
    dailyFormat: useId(),
    dailyTemplate: useId(),
    linkFormat: useId(),
    newNotes: useId(),
    newNoteFolder: useId(),
    captureTo: useId(),
    captureInbox: useId(),
  };
  return (
    <section aria-label="This repository">
      <SectionHeader
        title="This repository"
        description={
          <>
            Saved in the repository at <code className="text-[0.8em]">.noted/settings.json</code>, so they sync with it.
          </>
        }
      />
      <Group title="Links">
        <Row
          label="New links use"
          description="Markdown links also work on github.com. Existing links stay as they are; the command palette converts a note."
          id={ids.linkFormat}
        >
          <select
            id={ids.linkFormat}
            className="input"
            value={settings.linkFormat}
            onChange={(e) => save({ linkFormat: e.target.value as VaultSettings["linkFormat"] })}
          >
            <option value="wikilink">Wikilinks: [[Note]]</option>
            <option value="markdown">Markdown: [Note](Note.md)</option>
          </select>
        </Row>
        <Row label="New notes from links go in" description="Where a note is created when you open a link to it." id={ids.newNotes}>
          <select
            id={ids.newNotes}
            className="input"
            value={settings.newNoteLocation}
            onChange={(e) => save({ newNoteLocation: e.target.value as VaultSettings["newNoteLocation"] })}
          >
            <option value="current">The linking note&apos;s folder</option>
            <option value="root">The repository root</option>
            <option value="folder">A folder…</option>
          </select>
        </Row>
        {settings.newNoteLocation === "folder" && (
          <Row label="Folder for new notes from links" id={ids.newNoteFolder}>
            <TextSetting id={ids.newNoteFolder} value={settings.newNoteFolder} onSave={(v) => save({ newNoteFolder: v })} />
          </Row>
        )}
      </Group>
      <Group title="Files">
        <Row label="Attachment folder" description="Where pasted, dropped and uploaded files go." id={ids.attachments}>
          <TextSetting id={ids.attachments} value={settings.attachmentFolder} onSave={(v) => save({ attachmentFolder: v })} />
        </Row>
        <Row label="Templates folder" description="Notes here are offered by Insert template." id={ids.templates}>
          <TextSetting id={ids.templates} value={settings.templateFolder} onSave={(v) => save({ templateFolder: v })} />
        </Row>
      </Group>
      <Group title="Properties for new notes">
        <NewNoteProperties value={settings.newNoteProperties} onChange={(v) => save({ newNoteProperties: v })} />
      </Group>
      <Group title="Quick capture">
        <Row
          label="Captures go to"
          description="Quick notes, and things shared to the installed app, are added under a Captured heading with the time."
          id={ids.captureTo}
        >
          <select
            id={ids.captureTo}
            className="input"
            value={settings.captureTo}
            onChange={(e) => save({ captureTo: e.target.value as VaultSettings["captureTo"] })}
          >
            <option value="daily">Today&apos;s daily note</option>
            <option value="inbox">An inbox note</option>
          </select>
        </Row>
        {settings.captureTo === "inbox" && (
          <Row label="Inbox note" description="Created when the first capture arrives." id={ids.captureInbox}>
            <TextSetting id={ids.captureInbox} value={settings.captureInbox} placeholder="Inbox.md" onSave={(v) => save({ captureInbox: v })} />
          </Row>
        )}
      </Group>
      <Group title="Daily notes">
        <Row label="Daily notes folder" id={ids.dailyFolder}>
          <TextSetting id={ids.dailyFolder} value={settings.dailyFolder} onSave={(v) => save({ dailyFolder: v })} />
        </Row>
        <Row
          label="Daily note name"
          description={`Today: ${formatDate(new Date(), settings.dailyFormat || "YYYY-MM-DD")}`}
          id={ids.dailyFormat}
        >
          <TextSetting id={ids.dailyFormat} value={settings.dailyFormat} onSave={(v) => save({ dailyFormat: v })} />
        </Row>
        <Row label="Daily note template" description="A note path, such as Templates/Daily.md. Empty for none." id={ids.dailyTemplate}>
          <TextSetting
            id={ids.dailyTemplate}
            value={settings.dailyTemplate}
            placeholder="None"
            onSave={(v) => save({ dailyTemplate: v })}
          />
        </Row>
      </Group>
      <Group title="Drawings">
        <Row label="Save an SVG copy of each drawing" description="So drawings show as pictures on github.com.">
          <div className="flex sm:justify-end">
            <Switch
              label="Save an SVG copy of each drawing"
              checked={settings.drawingSvgCopy}
              onChange={(v) => save({ drawingSvgCopy: v })}
            />
          </div>
        </Row>
      </Group>
    </section>
  );
}
