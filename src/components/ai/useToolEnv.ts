"use client";

import { useMemo } from "react";
import type { ToolEnv } from "@/lib/ai/tools";
import { useVault } from "../vault/useVault";

/** What the agent may read: the repository's indexes, as they are when it looks. */
export function useToolEnv(): ToolEnv {
  const vault = useVault();
  return useMemo<ToolEnv>(
    () => ({
      links: vault.links,
      search: vault.index,
      files: () => vault.entries.filter((e) => e.kind === "file").map((e) => e.path),
      mtime: (p) => vault.entries.find((e) => e.path === p)?.mtime,
      ignored: (p) => vault.settings.healthIgnore.includes(p),
    }),
    [vault.links, vault.index, vault.entries, vault.settings.healthIgnore],
  );
}
