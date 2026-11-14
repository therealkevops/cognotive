/** Notes created in a brand-new vault so the first screen isn't empty. */
export const WELCOME_NOTES: Record<string, string> = {
  "Welcome.md": `# Welcome to noted-ai

This vault lives in your browser. To keep notes in a GitHub repository instead, open
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
| Reading view | Ctrl/Cmd + E |
| Quick switcher | Ctrl/Cmd + O |
| Search all notes | Ctrl/Cmd + Shift + F |
| Graph view | Ctrl/Cmd + G |

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
like [[Ideas]], are shown dashed: click one to create the note.

- [[Welcome#Formatting|Link to a heading]] with \`#\`, and change the text with \`|\`.
- Ctrl/Cmd-click a link in the editor to follow it, or click it in live preview.
- Tag notes with #guide or nested tags like #area/home.
- The **Links** panel on the right lists backlinks, unlinked mentions and outgoing links.
- Renaming a note updates every link to it.

Embed part of another note with \`![[Note#Heading]]\`:

![[Welcome#Maths and diagrams]]
`,
};
