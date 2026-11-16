"use client";

import { Check, ChevronsUpDown, FolderGit2, HardDrive, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useVaults } from "./useVaults";

/** The vault name at the top of the sidebar; opens a menu to switch vaults or manage them. */
export function VaultSwitcher({ onManage }: { onManage(): void }) {
  const { vaults, active, switchTo } = useVaults();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const Icon = active.kind === "github" ? FolderGit2 : HardDrive;
  return (
    <div ref={ref} className="relative mb-3">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Repository: ${active.name}. Switch repository`}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-serif text-[1.0625rem] hover:bg-foreground/[0.05]"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{active.name}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Repositories"
          className="menu-panel absolute inset-x-0 top-full z-20 mt-1 overflow-hidden p-1"
        >
          {vaults.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.id === active.id}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-foreground/[0.06]"
              onClick={() => {
                setOpen(false);
                switchTo(v.id);
              }}
            >
              <span className="w-4 shrink-0">{v.id === active.id && <Check size={14} aria-hidden />}</span>
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {v.kind === "github" && <FolderGit2 size={13} className="shrink-0 text-muted" aria-hidden />}
            </button>
          ))}
          <div className="mx-1 my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-foreground/[0.06]"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings size={14} className="shrink-0 text-muted" aria-hidden />
            Manage repositories…
          </button>
        </div>
      )}
    </div>
  );
}
