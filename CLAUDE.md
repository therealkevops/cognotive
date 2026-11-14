@AGENTS.md

# noted-ai

- Design and roadmap: `docs/PLAN.md`. Read it before starting a phase.
- Target is Vercel **Hobby**: keep work in the browser; server routes only for GitHub auth
  and the Claude proxy. Don't proxy note files or attachments through functions.
- Before committing, run `npm run check` and `npm run build`; for UI changes also
  `npm run test:e2e`.
- Unit tests sit next to the code as `*.test.ts(x)`; e2e tests live in `tests/e2e/`.
