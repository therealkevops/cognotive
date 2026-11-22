"use client";

import { Link2, Paperclip, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { isEmpty, type Captured } from "@/lib/capture/capture";
import { Modal } from "./Modal";

/**
 * Quick capture: type a thought (or review something shared to the app) and
 * it's added, with the time, to today's note or the inbox. Ctrl/Cmd+Enter saves.
 */
export function CaptureDialog({
  initial,
  destination,
  onSave,
  onClose,
}: {
  initial?: { captured: Captured; files: File[] };
  /** Where it goes, in words: "today's note (2026-11-22)". */
  destination: string;
  onSave(captured: Captured, files: File[]): Promise<void>;
  onClose(): void;
}) {
  const [text, setText] = useState(initial?.captured.text ?? "");
  const [link, setLink] = useState<{ url: string; title?: string } | null>(
    initial?.captured.url ? { url: initial.captured.url, ...(initial.captured.title ? { title: initial.captured.title } : {}) } : null,
  );
  const [files, setFiles] = useState<File[]>(initial?.files ?? []);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textId = useId();
  const captured: Captured = { text, ...(link ? { url: link.url, ...(link.title ? { title: link.title } : {}) } : {}) };
  const empty = isEmpty(captured) && files.length === 0;

  const save = async () => {
    if (empty || busy) return;
    setBusy(true);
    try {
      await onSave(captured, files);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label={initial ? "Save what you shared" : "Quick capture"} onClose={onClose}>
      {link && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
          <Link2 size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            {link.title && <span className="block truncate font-medium">{link.title}</span>}
            <span className="block truncate text-xs text-muted">{link.url}</span>
          </span>
          <button type="button" className="icon-button h-6 w-6" aria-label="Leave out the link" onClick={() => setLink(null)}>
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
      <label htmlFor={textId} className="sr-only">
        Note
      </label>
      <textarea
        id={textId}
        className="input min-h-28 w-full resize-y"
        placeholder={link || files.length ? "Add a note (optional)" : "What's on your mind?"}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {files.length > 0 && (
        <ul aria-label="Attachments" className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="properties-chip gap-1 px-2">
              <span className="max-w-48 truncate">{f.name}</span>
              <button type="button" aria-label={`Leave out ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X size={11} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">Adds to {destination}, with the time.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="button-secondary py-1 text-sm" onClick={() => fileInput.current?.click()}>
          <Paperclip size={14} aria-hidden /> Add a photo or file
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button type="button" className="button-primary ml-auto" disabled={empty || busy} onClick={() => void save()} title="Save (Ctrl/Cmd+Enter)">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
