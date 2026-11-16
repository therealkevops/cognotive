@AGENTS.md

# noted-ai

- Design and roadmap: `docs/PLAN.md`. Read it before starting a phase.
- Target is Vercel **Hobby**: keep work in the browser; the only planned server route is the
  Claude proxy (GitHub sync uses a token in the browser). Don't proxy note files or attachments
  through functions.
- Before committing, run `npm run check` and `npm run build`; for UI changes also
  `npm run test:e2e`.
- Unit tests sit next to the code as `*.test.ts(x)`; e2e tests live in `tests/e2e/`.
- Sync logic lives in `src/lib/sync/` and is tested against `FakeRemote`; e2e tests fake the
  GitHub API in the browser with `tests/e2e/fake-github.ts`. Never call real GitHub in tests.
