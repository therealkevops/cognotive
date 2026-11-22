"use client";

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useVault } from "../vault/useVault";

interface TagNode {
  tag: string;
  name: string;
  count: number;
  children: TagNode[];
}

function tagTree(counts: Map<string, number>): TagNode[] {
  const root: TagNode[] = [];
  const nodes = new Map<string, TagNode>();
  for (const tag of [...counts.keys()].sort()) {
    const node: TagNode = { tag, name: tag.split("/").pop()!, count: counts.get(tag)!, children: [] };
    nodes.set(tag, node);
    const parent = tag.includes("/") ? nodes.get(tag.slice(0, tag.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : root).push(node);
  }
  return root;
}

/** Every tag in the vault with how many notes use it. Click a tag to list those notes. */
export function TagsPanel({ onTag }: { onTag(tag: string): void }) {
  const vault = useVault();
  const tree = useMemo(
    () => tagTree(vault.indexed.links.tags()),
    [vault.indexed],
  );
  return (
    <section aria-label="Tags" className="flex h-full flex-col">
      <h2 className="mb-2 text-xs font-medium text-muted">Tags</h2>
      {tree.length === 0 ? (
        <p className="text-sm text-muted">No tags yet. Add one with #tag in a note, or tags: in its properties.</p>
      ) : (
        <ul className="-mx-2 flex-1 overflow-y-auto">
          {tree.map((n) => (
            <Tag key={n.tag} node={n} depth={0} onTag={onTag} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Tag({ node, depth, onTag }: { node: TagNode; depth: number; onTag(tag: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center rounded hover:bg-foreground/5" style={{ paddingLeft: `${depth * 0.9}rem` }}>
        {node.children.length ? (
          <button
            type="button"
            className="icon-button h-6 w-6"
            aria-label={open ? `Collapse #${node.tag}` : `Expand #${node.tag}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={14} aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-6" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between py-1 pr-2 text-left text-sm"
          onClick={() => onTag(node.tag)}
        >
          <span className="truncate">#{node.name}</span>
          <span className="ml-2 shrink-0 text-xs text-muted">{node.count}</span>
        </button>
      </div>
      {open && (
        <ul>
          {node.children.map((c) => (
            <Tag key={c.tag} node={c} depth={depth + 1} onTag={onTag} />
          ))}
        </ul>
      )}
    </li>
  );
}
