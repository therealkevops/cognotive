import type { Blockquote, Paragraph, PhrasingContent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

/** `==highlighted==` → <mark>, as in Obsidian. */
export function remarkHighlight() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || !node.value.includes("==")) return;
      const parts = node.value.split(/==(?=\S)(.+?)(?<=\S)==/);
      if (parts.length === 1) return;
      const replacement: PhrasingContent[] = parts.flatMap((value, i): PhrasingContent[] => {
        if (i % 2 === 0) return value ? [{ type: "text", value }] : [];
        return [
          {
            type: "emphasis",
            data: { hName: "mark" },
            children: [{ type: "text", value }],
          },
        ];
      });
      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}

export const CALLOUT_TYPES = [
  "note",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
  "abstract",
  "todo",
] as const;

const CALLOUT_ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const CALLOUT_HEAD = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(\n|$)/;

/**
 * Obsidian callouts:
 *   > [!warning] Optional title
 *   > Body text
 * become <div class="callout callout-warning"> with a title row and body.
 * Unknown types render as "note".
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const lead = first.children[0];
      if (lead?.type !== "text") return;
      const m = CALLOUT_HEAD.exec(lead.value);
      if (!m) return;

      const raw = m[1].toLowerCase();
      const type = (CALLOUT_TYPES as readonly string[]).includes(raw)
        ? raw
        : (CALLOUT_ALIASES[raw] ?? "note");
      const titleText = m[3].trim() || raw.charAt(0).toUpperCase() + raw.slice(1);

      // Whatever follows the head line in the first paragraph is body text.
      const rest = lead.value.slice(m[0].length);
      const remaining: PhrasingContent[] = [
        ...(rest ? [{ type: "text", value: rest } as Text] : []),
        ...first.children.slice(1),
      ];
      const titleInline: PhrasingContent[] = [{ type: "text", value: titleText }];
      // An inline title can continue with formatting on the same line (e.g. "**bold**").
      if (!m[4] && first.children.length > 1 && !rest) {
        titleInline.push(...remaining.splice(0));
      }

      const title: Paragraph = {
        type: "paragraph",
        data: { hName: "div", hProperties: { className: ["callout-title"] } },
        children: titleInline,
      };
      const body = [
        ...(remaining.length ? [{ type: "paragraph", children: remaining } as Paragraph] : []),
        ...node.children.slice(1),
      ];

      node.data = {
        hName: "div",
        hProperties: { className: ["callout", `callout-${type}`], dataCallout: type },
      };
      node.children = [
        title,
        {
          type: "blockquote",
          data: { hName: "div", hProperties: { className: ["callout-content"] } },
          children: body,
        },
      ];
    });
  };
}
