"use client";

import { DOWNLOAD_MB } from "@/lib/semantic/model";
import { Group, Row, SectionHeader, Switch } from "../settings/parts";
import { useSemantic, type SemanticStatus } from "./useSemantic";

export function statusText(s: SemanticStatus): string {
  switch (s.state) {
    case "off":
      return "Off.";
    case "starting":
      return "Starting…";
    case "downloading":
      return `Downloading the search model: ${Math.round((s.loaded / s.total) * 100)}%`;
    case "indexing":
      return `Indexing notes: ${s.done} of ${s.total}`;
    case "ready":
      return `Ready: ${s.notes} ${s.notes === 1 ? "note" : "notes"} indexed.`;
    case "error":
      return `Search by meaning stopped: ${s.message}`;
  }
}

/** Settings → Search: search by meaning, on this device. */
export function SearchSection() {
  const sem = useSemantic();
  const s = sem.status;
  const progress = s.state === "downloading" ? s.loaded / s.total : s.state === "indexing" ? s.done / s.total : null;
  return (
    <section aria-label="Search">
      <SectionHeader title="Search" description="How search finds your notes. These apply to this browser only." />
      <Group>
        <Row
          label="Search by meaning"
          description={`Finds notes that mean what you searched for, even in other words, alongside the usual word matches. It also suggests similar notes in Connections, and helps the AI agent find the right notes. A small model (about ${DOWNLOAD_MB} MB, downloaded once) runs in this browser: your notes never leave it.`}
        >
          <div className="flex sm:justify-end">
            <Switch label="Search by meaning" checked={sem.enabled} onChange={sem.setEnabled} />
          </div>
        </Row>
        {sem.enabled && (
          <Row label="Status" stack>
            <div className="flex items-center gap-3">
              <p role="status" aria-label="Search by meaning status" className={`min-w-0 flex-1 text-sm ${s.state === "error" ? "text-[#c2412d]" : ""}`}>
                {statusText(s)}
              </p>
              <button
                type="button"
                className="button-secondary shrink-0 py-1 text-sm"
                title="Forget this repository's index and build it again"
                disabled={s.state === "starting" || s.state === "downloading"}
                onClick={sem.rebuild}
              >
                Rebuild index
              </button>
            </div>
            {progress !== null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </Row>
        )}
      </Group>
    </section>
  );
}
