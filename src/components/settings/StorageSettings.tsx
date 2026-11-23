"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, requestPersistence, storageStatus, type StorageStatus } from "@/lib/storage-safety";
import { cacheUsage, removeModel, repositoryUsage, storageParts, type RepositoryUsage, type StoragePart } from "@/lib/storage-usage";
import { useVaults } from "../vault/useVaults";
import { Group, Row, SectionHeader } from "./parts";

/* What k-note keeps in this browser, and whether the browser will keep it. */

const COLOURS: Record<StoragePart["id"], string> = {
  notes: "var(--series-1)",
  attachments: "var(--series-2)",
  model: "var(--series-3)",
  index: "var(--series-4)",
  rest: "var(--series-rest)",
};

interface Measured {
  repos: RepositoryUsage[];
  parts: StoragePart[];
  total: number;
  status: StorageStatus;
}

export function StorageSection() {
  const { vaults } = useVaults();
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [asked, setAsked] = useState(false);

  const ids = vaults.map((v) => v.id).join("\u0000");
  useEffect(() => {
    let live = true;
    (async () => {
      const [repos, caches, status] = await Promise.all([
        Promise.all(ids.split("\u0000").map((id) => repositoryUsage(id))),
        cacheUsage(),
        storageStatus(),
      ]);
      if (!live) return;
      setMeasured({ repos, status, ...storageParts(repos, caches, status.usage) });
    })().catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ids, round, asked]);

  const again = () => {
    setMeasured(null);
    setRound((r) => r + 1);
  };
  const status = measured?.status;
  const model = measured?.parts.find((p) => p.id === "model");

  return (
    <section aria-label="Storage">
      <SectionHeader title="Storage" description="What k-note keeps in this browser on this device." />
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t measure the storage: {error}
        </p>
      ) : !measured ? (
        <p role="status" className="text-sm text-muted">
          Measuring…
        </p>
      ) : (
        <>
          <div className="mb-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm">
                <span className="font-serif text-2xl">{formatBytes(measured.total)}</span>{" "}
                <span className="text-muted">
                  used{status?.quota ? ` of ${formatBytes(status.quota)} the browser allows this site` : ""}
                </span>
              </p>
              <button type="button" className="icon-button h-8 w-8" aria-label="Measure again" title="Measure again" onClick={again}>
                <RotateCcw size={14} aria-hidden />
              </button>
            </div>
            <Breakdown parts={measured.parts} total={measured.total} />
          </div>

          <Group>
            <ul aria-label="Storage by kind" className="divide-y divide-border">
              {measured.parts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOURS[p.id] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-[0.8125rem] leading-snug text-muted">{p.detail}</p>
                    {p.id === "model" && p.bytes > 0 && (
                      <button
                        type="button"
                        className="button-secondary mt-2 px-2.5 py-1 text-xs"
                        title="Frees the space. Search by meaning downloads it again from this app when next used (it needs a connection then)."
                        onClick={async () => {
                          await removeModel();
                          again();
                        }}
                      >
                        <Trash2 size={12} aria-hidden /> Remove
                      </button>
                    )}
                  </div>
                  <span className="w-20 shrink-0 text-right text-sm tabular-nums">{formatBytes(p.bytes)}</span>
                </li>
              ))}
            </ul>
          </Group>
          {model && model.bytes > 0 && (
            <p className="-mt-3 mb-6 text-[0.8125rem] leading-snug text-muted">
              The search model runs on this device, so search by meaning works offline and nothing is sent anywhere. Removing it frees the space; it&apos;s downloaded again from this app the next time search by meaning runs.
            </p>
          )}

          {measured.repos.length > 1 && (
            <Group title="By repository">
              {measured.repos.map((r) => {
                const name = vaults.find((v) => v.id === r.id)?.name ?? r.id;
                const bytes = r.text.bytes + r.attachments.bytes + r.searchIndex.bytes + r.sync;
                return (
                  <Row
                    key={r.id}
                    label={name}
                    description={`Notes ${formatBytes(r.text.bytes)}, attachments ${formatBytes(r.attachments.bytes)}, search index ${formatBytes(r.searchIndex.bytes)}${r.sync ? `, sync records ${formatBytes(r.sync)}` : ""}`}
                  >
                    <span className="block text-sm tabular-nums sm:text-right">{formatBytes(bytes)}</span>
                  </Row>
                );
              })}
            </Group>
          )}

          {status?.supported && (
            <Group title="Keeping it">
              <Row
                label={status.persisted ? "Kept permanently" : "May be cleared by the browser"}
                description={
                  <>
                    {status.persisted
                      ? "The browser won't delete your notes to free up space."
                      : "When space runs low (or, in Safari, after a week without a visit) the browser may delete what's stored here. Repositories synced with GitHub keep a copy there; the others only exist here."}
                    {asked && !status.persisted && " The browser said no; it decides by how much you use the app. Installing the app usually helps."}
                  </>
                }
              >
                {!status.persisted && (
                  <div className="flex sm:justify-end">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={async () => {
                        await requestPersistence();
                        setAsked(true);
                      }}
                    >
                      Keep notes on this device
                    </button>
                  </div>
                )}
              </Row>
            </Group>
          )}
        </>
      )}
    </section>
  );
}

/** One bar split into the parts, widths by size; a part too small to see still shows a sliver. */
function Breakdown({ parts, total }: { parts: StoragePart[]; total: number }) {
  const shown = parts.filter((p) => p.bytes > 0);
  if (!total || shown.length === 0) return null;
  return (
    <div className="mt-3 flex h-2 w-full gap-[2px]" role="img" aria-label={shown.map((p) => `${p.label} ${formatBytes(p.bytes)}`).join(", ")}>
      {shown.map((p) => (
        <span
          key={p.id}
          title={`${p.label}: ${formatBytes(p.bytes)}`}
          className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
          style={{ background: COLOURS[p.id], flexGrow: p.bytes, flexBasis: 0, minWidth: 4 }}
        />
      ))}
    </div>
  );
}
