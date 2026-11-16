/** Notes created in a brand-new vault so the first screen isn't empty. */
export const WELCOME_NOTES: Record<string, string> = {
  "Welcome.md": `# Welcome to noted-ai

This repository lives in your browser. To sync your notes with GitHub instead, open
**Settings** at the bottom of the sidebar. Next, read [[Linking notes]].

## Formatting

**Bold**, *italic*, ~~strikethrough~~, ==highlight== and \`inline code\`.
Select text and use the toolbar, or the shortcuts:

| Action | Shortcut |
| --- | --- |
| Bold / italic | Ctrl/Cmd + B / I |
| Link | Ctrl/Cmd + K |
| Heading 1–3 | Ctrl/Cmd + Alt + 1–3 |
| Bullet / numbered / task list | Ctrl/Cmd + Shift + 8 / 7 / 9 |
| Tick a task | Ctrl/Cmd + Enter |
| Follow the link at the cursor | Alt + Enter |
| Back / forward | Ctrl/Cmd + Alt + ← / → |
| Reading view | Ctrl/Cmd + E |
| Quick switcher | Ctrl/Cmd + O |
| Search all notes | Ctrl/Cmd + Shift + F |

- [x] Write a note
- [ ] Try the reading view

> [!tip] Live preview
> Markdown syntax hides itself when the cursor is elsewhere. Click into a line to see it.

## Maths and diagrams

Euler: $e^{i\\pi} + 1 = 0$

$$
\\int_0^1 x^2\\,dx = \\tfrac{1}{3}
$$

\`\`\`mermaid
graph LR
  Note --> Link --> Graph
\`\`\`

\`\`\`ts
const greeting: string = "hello";
\`\`\`
`,
  "Linking notes.md": `---
tags: [guide]
aliases: [Links]
---
# Linking notes

Type \`[[\` to link another note, such as [[Welcome]]. Links to notes that don't exist yet,
like [[Ideas]], are shown dashed: open one to create the note.

- [[Welcome#Formatting|Link to a heading]] with \`#\`, and change the text with \`|\`.
- Click a link in live preview to edit it; click the ↗ after it, or press Alt+Enter, to follow it.
  (Settings can make a click follow the link instead.)
- Ctrl/Cmd-click opens a link in a new tab, Ctrl/Cmd+Alt-click in the side pane.
- Back and forward (the arrows by the title) retrace the notes you've followed.
- Tag notes with #guide or nested tags like #area/home.
- The **Connections** panel on the right shows links in and out, notes that share links, and unlinked mentions. **Map as canvas** lays them out on a board.
- **Repository health** (bottom of the sidebar) lists broken links, orphans and hubs.
- Renaming a note updates every link to it.

## Hubs

A hub is a note that holds an area together, like a contents page. Give each area one (the
*Map of content* starter template makes one), link new notes to their hub as you write, and let
the hub collect links rather than content. Repository health finds hubs (notes many others link
to, and index notes that link out to many) and lists missing notes that already have enough links
to be one. Pin a note as a hub with \`hub: true\` in its properties, or the command
*Pin this note to the sidebar as a hub*: pinned hubs are listed at the top of the sidebar.

Embed part of another note with \`![[Note#Heading]]\`:

![[Welcome#Maths and diagrams]]
`,
};
