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
    <div className="dialog-backdrop pt-[15vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog-panel max-w-md p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate font-serif text-xl">{label}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
