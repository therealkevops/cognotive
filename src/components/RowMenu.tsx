"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem =
  | {
      label: string;
      icon?: LucideIcon;
      onSelect(): void;
      /** Shown in red: deleting and the like. */
      danger?: boolean;
    }
  | "separator";

export interface RowMenuHandle {
  /** Opens the menu at a point (a right-click), instead of under the button. */
  openAt(x: number, y: number): void;
}

const MENU_WIDTH = 200;

/**
 * A row's "more" button (three dots) and the menu it opens, with the row's actions as
 * labelled items. Shown when the row is hovered or focused (the parent row needs the
 * `group` class), and while the menu is open. Keyboard: Enter, Space or Down opens it;
 * arrow keys, Home and End move; Escape closes it and returns to the button.
 */
export const RowMenu = forwardRef<
  RowMenuHandle,
  {
    label: string;
    items: RowMenuItem[];
    className?: string;
    alwaysVisible?: boolean;
    /** The button's own content and look instead of the three dots (it's then always shown). */
    button?: { content: ReactNode; className: string; title: string };
  }
>(
  function RowMenu({ label, items, className = "", alwaysVisible = false, button: custom }, ref) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<{ x: number; y: number; fromButton: boolean } | null>(null);
    const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

    const close = useCallback((refocus: boolean) => {
      setAt(null);
      setPlace(null);
      if (refocus) button.current?.focus();
    }, []);

    const openUnderButton = () => {
      const r = button.current!.getBoundingClientRect();
      setAt({ x: r.right, y: r.bottom + 4, fromButton: true });
    };
    useImperativeHandle(ref, () => ({ openAt: (x, y) => setAt({ x, y, fromButton: false }) }), []);

    // Keep it on screen: under the button, right edges lined up (or at the pointer), and
    // above it when there's no room below.
    useLayoutEffect(() => {
      if (!at || !panel.current) return;
      const h = panel.current.offsetHeight;
      let left = at.fromButton ? at.x - MENU_WIDTH : at.x;
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
      let top = at.y;
      if (top + h > window.innerHeight - 8) {
        const above = at.fromButton ? button.current!.getBoundingClientRect().top - h - 4 : at.y - h;
        top = Math.max(8, above);
      }
      setPlace({ left, top });
    }, [at]);

    // Focus the first item once it's placed; close on a click elsewhere, scrolling or resizing.
    useEffect(() => {
      if (!at || !place) return;
      panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      const outside = (e: MouseEvent) => {
        if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false);
      };
      const away = () => close(false);
      document.addEventListener("mousedown", outside);
      window.addEventListener("resize", away);
      window.addEventListener("scroll", away, true);
      return () => {
        document.removeEventListener("mousedown", outside);
        window.removeEventListener("resize", away);
        window.removeEventListener("scroll", away, true);
      };
    }, [at, place, close]);

    const onMenuKey = (e: KeyboardEvent) => {
      // The menu is drawn in a portal but still sits inside the row in React's tree: keys
      // pressed here aren't the row's (Enter would open the note).
      e.stopPropagation();
      const entries = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const i = entries.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => entries[(n + entries.length) % entries.length]?.focus();
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(entries.length - 1);
      else if (e.key === "Escape") close(true);
      else if (e.key === "Tab") close(false);
      else return;
      e.preventDefault();
    };

    const open = !!at;
    return (
      <>
        <button
          ref={button}
          type="button"
          className={
            custom
              ? custom.className
              : `icon-button h-6 w-6 shrink-0 ${open || alwaysVisible ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"} ${className}`
          }
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          title={custom?.title ?? "More"}
          onClick={(e) => {
            e.stopPropagation();
            if (open) close(false);
            else openUnderButton();
          }}
          onKeyDown={(e) => {
            // Keys on the button are its own, not the row's (Enter would open the note).
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              openUnderButton();
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {custom ? custom.content : <MoreHorizontal size={15} aria-hidden />}
        </button>
        {open &&
          createPortal(
            <div
              ref={panel}
              role="menu"
              aria-label={label}
              className="menu-panel fixed z-50 p-1"
              style={{ width: MENU_WIDTH, left: place?.left ?? -9999, top: place?.top ?? -9999 }}
              onKeyDown={onMenuKey}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {items.map((item, i) =>
                item === "separator" ? (
                  <div key={`sep-${i}`} role="separator" className="mx-1 my-1 border-t border-border" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-foreground/[0.06] focus:bg-foreground/[0.06] ${
                      item.danger ? "text-red-600 dark:text-red-400" : ""
                    }`}
                    onClick={() => {
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {item.icon && <item.icon size={14} aria-hidden className={`shrink-0 ${item.danger ? "" : "text-muted"}`} />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                ),
              )}
            </div>,
            document.body,
          )}
      </>
    );
  },
);
