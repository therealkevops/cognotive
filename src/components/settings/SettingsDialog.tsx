"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AiSection } from "../ai/AiSettings";
import { SearchSection } from "../semantic/SemanticSettings";
import { AppearanceSection, EditorSection } from "./AppearanceSettings";
import { ThisVaultSection } from "./RepositorySettings";
import { InstallSection } from "./InstallSettings";
import { VaultsSection } from "./VaultsSettings";
import { StorageSection } from "./StorageSettings";

export type SettingsSection = "appearance" | "editor" | "search" | "ai" | "vault" | "vaults" | "storage" | "app";

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "search", label: "Search" },
  { id: "ai", label: "AI" },
  { id: "vault", label: "This repository" },
  { id: "vaults", label: "Repositories & sync" },
  { id: "storage", label: "Storage" },
  { id: "app", label: "Install app" },
];

/**
 * Settings, in sections: a list on the left, labelled rows on the right.
 * Changes apply as they're made; text fields save when you leave them.
 */
export function SettingsDialog({ onClose, initial = "appearance" }: { onClose(): void; initial?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="dialog-panel relative flex h-[min(44rem,88vh)] max-w-4xl flex-col overflow-hidden md:flex-row"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-sidebar p-3 pr-14 md:w-56 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-4"
        >
          <h2 className="mb-3 hidden px-2.5 font-serif text-2xl md:block">Settings</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="nav-item shrink-0 text-left"
              aria-current={section === s.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-8">
          <div className="mx-auto max-w-2xl">
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "search" && <SearchSection />}
            {section === "ai" && <AiSection />}
            {section === "vault" && <ThisVaultSection />}
            {section === "vaults" && <VaultsSection />}
            {section === "storage" && <StorageSection />}
            {section === "app" && <InstallSection />}
          </div>
        </div>
        <button
          type="button"
          className="icon-button absolute top-3 right-3"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
