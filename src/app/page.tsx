import { AppShell } from "@/components/AppShell";
import { APP_NAME } from "@/lib/app-info";

export default function Home() {
  return (
    <AppShell
      sidebar={
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Vault
          </h2>
          <p className="text-sm text-muted">No vault yet. Storage arrives in phase 1.</p>
        </>
      }
      panel={
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Backlinks
          </h2>
          <p className="text-sm text-muted">Links appear here in phase 3.</p>
        </>
      }
    >
      <article className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-muted">
          Markdown notes with wikilinks, a knowledge graph, Excalidraw drawings and an LLM
          that can explore them. Notes are stored in a GitHub repository you choose.
        </p>
      </article>
    </AppShell>
  );
}
