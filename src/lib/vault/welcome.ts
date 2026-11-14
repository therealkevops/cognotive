/** Notes created in a brand-new vault so the first screen isn't empty. */
export const WELCOME_NOTES: Record<string, string> = {
  "Welcome.md": `# Welcome to noted-ai

This vault lives in your browser for now. Phase 2 adds GitHub repositories as storage.

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
};
