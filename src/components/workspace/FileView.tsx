"use client";

import { useEffect, useMemo, useState } from "react";
import { collectPropertyInfo } from "@/lib/editor/properties";
import { basename, mimeType } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { PropertiesEditor } from "./PropertiesEditor";

/**
 * Shows an attachment: images, PDFs, audio and video; a download link for
 * anything else. Its properties (tags, aliases…) are editable above it.
 */
export function FileView({ path }: { path: string }) {
  const vault = useVault();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const mtime = vault.entries.find((e) => e.path === path)?.mtime;
  const info = useMemo(
    () => collectPropertyInfo(vault.links, vault.settings.propertyTypes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion, vault.settings.propertyTypes],
  );

  useEffect(() => {
    let live = true;
    void vault.fileUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
    // Re-load when the file changes (mtime), e.g. after a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, mtime, vault.fileUrl]);

  if (url === undefined) return <p className="p-8 text-muted">Loading…</p>;
  if (url === null) return <p className="p-8 text-muted">This file couldn&apos;t be loaded.</p>;

  const type = mimeType(path);
  const name = basename(path);
  return (
    <div className="flex h-full flex-col items-center gap-3 p-6" data-testid="file-view">
      <div className="w-full max-w-2xl shrink-0">
        <PropertiesEditor
          properties={vault.fileProperties(path)}
          info={info}
          onSet={(key, value) => void vault.setFileProperty(path, key, value)}
        />
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3">
      {type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element -- object URL from the vault
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      ) : type === "application/pdf" ? (
        <iframe src={url} title={name} className="h-full w-full rounded border border-border" />
      ) : type.startsWith("audio/") ? (
        <audio src={url} controls className="mt-16 w-full max-w-lg" />
      ) : type.startsWith("video/") ? (
        <video src={url} controls className="max-h-full max-w-full" />
      ) : null}
      <a href={url} download={name} className="text-sm text-accent hover:underline">
        Download {name}
      </a>
      </div>
    </div>
  );
}
