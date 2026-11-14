"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/** A small centred dialog. Escape or a click outside closes it. */
export function Modal({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[15vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{label}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
