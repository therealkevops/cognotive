"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PROPERTY_DOCS, type PropertyInfo } from "@/lib/editor/properties";

/**
 * A note's properties in the reading view, editable in place with the same
 * suggestions as the editor: names (with what each does), the repository's
 * tags, values used before, true/false, dates.
 */
export function PropertiesEditor({
  properties,
  info,
  onSet,
}: {
  properties: Record<string, unknown>;
  info: PropertyInfo;
  /** Sets a property (a value, or a list of them), or removes it (undefined). */
  onSet(key: string, value: unknown): void;
}) {
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const entries = Object.entries(properties);
  const names = useMemo(() => {
    const present = new Set(Object.keys(properties));
    const known = Object.entries(PROPERTY_DOCS).map(([key, d]) => ({ value: key, detail: d.kind, info: d.doc }));
    const own = info.keys
      .filter((k) => !PROPERTY_DOCS[k.key])
      .map((k) => ({ value: k.key, detail: `used in ${k.count} ${k.count === 1 ? "note" : "notes"}` }));
    return [...known, ...own].filter((o) => !present.has(o.value));
  }, [properties, info]);

  const add = (key: string) => {
    const k = key.trim();
    if (!/^[A-Za-z][\w-]*$/.test(k) || k in properties) return;
    const kind = PROPERTY_DOCS[k]?.kind;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    onSet(k, kind === "date" ? today : kind === "list" ? [] : kind === "boolean" ? true : "");
    setAdding(false);
    setJustAdded(k);
  };

  return (
    <section aria-label="Properties" className="properties-editor mb-6">
      <dl>
        {entries.map(([key, value]) => (
          <div key={key} className="properties-row group" title={PROPERTY_DOCS[key]?.doc}>
            <dt>{key}</dt>
            <dd>
              <ValueEditor name={key} value={value} info={info} onSet={(v) => onSet(key, v)} autoFocus={justAdded === key} />
            </dd>
            <button
              type="button"
              className="icon-button h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Remove ${key}`}
              onClick={() => onSet(key, undefined)}
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        ))}
      </dl>
      {adding ? (
        <div className="mt-1 max-w-xs">
          <Combobox
            label="New property name"
            placeholder="Property name"
            options={names}
            free
            autoFocus
            onChoose={add}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button type="button" className="properties-add" onClick={() => setAdding(true)}>
          <Plus size={13} aria-hidden /> Add property
        </button>
      )}
    </section>
  );
}

function ValueEditor({
  name,
  value,
  info,
  onSet,
  autoFocus,
}: {
  name: string;
  value: unknown;
  info: PropertyInfo;
  onSet(v: unknown): void;
  autoFocus: boolean;
}) {
  const kind = PROPERTY_DOCS[name]?.kind ?? (Array.isArray(value) ? "list" : typeof value === "boolean" ? "boolean" : "text");

  if (kind === "boolean") {
    const on = value === true || /^(true|yes)$/i.test(String(value ?? ""));
    return <input type="checkbox" aria-label={name} checked={on} onChange={(e) => onSet(e.target.checked)} autoFocus={autoFocus} />;
  }

  if (kind === "list") {
    const items = (Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value]).map(String);
    const pool = name === "tags" ? info.tags : name === "aliases" ? [] : info.values(name);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className={`properties-chip ${name === "tags" ? "properties-tag" : ""}`}>
            {name === "tags" ? `#${item}` : item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onSet(items.filter((_, j) => j !== i))}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <div className="min-w-[8rem] flex-1">
          <Combobox
            label={`Add to ${name}`}
            placeholder={name === "tags" ? "Add a tag" : "Add"}
            options={pool.filter((p) => !items.includes(p)).map((p) => ({ value: p }))}
            free
            autoFocus={autoFocus}
            onChoose={(v) => {
              const t = (name === "tags" ? v.replace(/^#/, "") : v).trim();
              if (t && !items.includes(t)) onSet([...items, t]);
            }}
            clearOnChoose
          />
        </div>
      </div>
    );
  }

  if (kind === "date") {
    const v = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
    return (
      <input
        type="date"
        aria-label={name}
        className="properties-input"
        value={/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""}
        autoFocus={autoFocus}
        onChange={(e) => onSet(e.target.value)}
      />
    );
  }

  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <Combobox
      label={name}
      initial={text}
      options={info.values(name).map((v) => ({ value: v }))}
      free
      autoFocus={autoFocus}
      onChoose={(v) => v !== text && onSet(v)}
      commitOnBlur
    />
  );
}

/**
 * A text box with a list of suggestions under it (arrow keys, Enter, Escape),
 * filtered by what's typed. `free`: what's typed can be chosen too.
 */
function Combobox({
  label,
  placeholder,
  options,
  initial = "",
  free = false,
  autoFocus = false,
  clearOnChoose = false,
  commitOnBlur = false,
  onChoose,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  options: Array<{ value: string; detail?: string; info?: string }>;
  initial?: string;
  free?: boolean;
  autoFocus?: boolean;
  clearOnChoose?: boolean;
  commitOnBlur?: boolean;
  onChoose(value: string): void;
  onCancel?(): void;
}) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const q = text.trim().toLowerCase();
  const shown = options
    .filter((o) => !q || o.value.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.value.toLowerCase().startsWith(q)) - Number(!b.value.toLowerCase().startsWith(q)))
    .slice(0, 12);

  const choose = (v: string) => {
    setOpen(false);
    onChoose(v);
    if (clearOnChoose) setText("");
    else setText(v);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = open && shown[active] ? shown[active].value : free || shown.some((o) => o.value === text.trim()) ? text.trim() : shown[0]?.value;
      if (pick !== undefined && (pick !== "" || free)) choose(pick);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else {
        setText(initial);
        onCancel?.();
      }
    }
  };

  return (
    <div className="relative">
      <input
        ref={input}
        className="properties-input w-full"
        role="combobox"
        aria-label={label}
        aria-expanded={open && shown.length > 0}
        aria-controls={id}
        aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKey}
        onBlur={() => {
          setOpen(false);
          if (commitOnBlur && text !== initial) onChoose(text.trim());
          if (!commitOnBlur && !text.trim()) onCancel?.();
        }}
      />
      {open && shown.length > 0 && (
        <ul id={id} role="listbox" aria-label={`${label} suggestions`} className="properties-suggestions menu-panel">
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              title={o.info}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="font-medium">{o.value}</span>
              {o.detail && <span className="ml-2 text-xs text-muted">{o.detail}</span>}
              {o.info && i === active && <span className="mt-0.5 block text-xs text-muted">{o.info}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
