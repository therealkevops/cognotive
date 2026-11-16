"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  appManifest,
  convertManifestCode,
  defaultAppName,
  envVars,
  randomSessionSecret,
  type CreatedApp,
} from "@/lib/github/app-manifest";

const STATE_KEY = "noted-ai:github-setup-state";

type Step =
  | { kind: "checking" }
  | { kind: "configured" }
  | { kind: "start" }
  | { kind: "converting" }
  | { kind: "created"; app: CreatedApp; sessionSecret: string }
  | { kind: "error"; message: string };

/**
 * Sets up GitHub sync for this deployment: creates a GitHub App with the right
 * settings in one click (GitHub's manifest flow), then shows the values to add
 * in Vercel. Everything happens in the browser; the credentials are shown once
 * and never stored.
 */
export function GitHubSetup() {
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (!code) {
        const body = await fetch("/api/auth/token", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ configured?: boolean }>)
          .catch(() => ({ configured: false }));
        setStep(body.configured === false ? { kind: "start" } : { kind: "configured" });
        return;
      }
      // Don't leave the one-time code in the address bar or history.
      window.history.replaceState(null, "", window.location.pathname);
      let expected: string | null = null;
      try {
        expected = sessionStorage.getItem(STATE_KEY);
        sessionStorage.removeItem(STATE_KEY);
      } catch {
        // storage blocked: the state check fails below
      }
      if (!expected || params.get("state") !== expected) {
        setStep({ kind: "error", message: "This setup link didn't start here, so it was ignored. Start again." });
        return;
      }
      setStep({ kind: "converting" });
      try {
        setStep({ kind: "created", app: await convertManifestCode(code), sessionSecret: randomSessionSecret() });
      } catch (e) {
        setStep({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm text-muted hover:text-accent">
          ← Back to notes
        </Link>
        <h1 className="mt-4 font-serif text-3xl">Set up GitHub sync</h1>
        <p className="mt-2 text-muted">
          noted-ai syncs each repository with a GitHub repository through a GitHub App that you own. It can only see
          the repositories you choose.
        </p>
        <div className="mt-8">
          {step.kind === "checking" && <p className="text-muted">Checking this deployment…</p>}
          {step.kind === "configured" && <Configured />}
          {step.kind === "start" && <Start />}
          {step.kind === "converting" && <p className="text-muted">Collecting the new app&apos;s details from GitHub…</p>}
          {step.kind === "created" && <Created app={step.app} sessionSecret={step.sessionSecret} />}
          {step.kind === "error" && (
            <div role="alert" className="rounded-lg border border-border p-4">
              <p>{step.message}</p>
              <a href="/github-setup" className="button-secondary mt-3 inline-flex">
                Start again
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Configured() {
  return (
    <div className="rounded-lg border border-border p-4">
      <p>GitHub is already set up on this deployment.</p>
      <p className="mt-1 text-sm text-muted">
        Open <strong>Settings → GitHub account</strong> to sign in, then connect a repository under{" "}
        <strong>Repositories &amp; sync</strong>.
      </p>
      <Link href="/" className="button-primary mt-3 inline-flex">
        Open noted-ai
      </Link>
    </div>
  );
}

function Start() {
  const [name, setName] = useState(() => defaultAppName());
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState("");
  useEffect(() => {
    // Read the address after mount; this page is pre-rendered without one.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only values
    setOrigin(window.location.origin);
    setState(crypto.randomUUID());
  }, []);
  const valid = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,32}$/.test(name.trim());
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(origin);

  return (
    <ol className="space-y-6">
      <li>
        <h2 className="font-medium">1. Create the GitHub App</h2>
        <p className="mt-1 text-sm text-muted">
          GitHub will ask you to confirm the name and create it. It gets read and write access to the contents of the
          repositories you pick, and nothing else.
        </p>
        <form
          method="post"
          action={`https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`}
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            if (!valid || !origin) return e.preventDefault();
            try {
              sessionStorage.setItem(STATE_KEY, state);
            } catch {
              // storage blocked: the return step will ask to start again
            }
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            App name <span className="text-xs text-muted">Unique across GitHub. Only you will see it.</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={34} />
          </label>
          <input type="hidden" name="manifest" value={origin ? JSON.stringify(appManifest(origin, name)) : ""} />
          <button type="submit" className="button-primary" disabled={!valid || !origin}>
            Create GitHub App <ExternalLink size={14} aria-hidden />
          </button>
        </form>
        {local && (
          <p className="mt-2 text-xs text-muted">
            You&apos;re on a local address, so this app will only sign in here. Run the setup on your Vercel address for
            the deployed app.
          </p>
        )}
      </li>
      <li className="text-muted">
        <h2 className="font-medium">2. Add its details to Vercel</h2>
        <p className="mt-1 text-sm">Shown here when you come back from GitHub.</p>
      </li>
      <li className="text-muted">
        <h2 className="font-medium">3. Install it on a repository and sign in</h2>
      </li>
    </ol>
  );
}

function Created({ app, sessionSecret }: { app: CreatedApp; sessionSecret: string }) {
  const vars = envVars(app, sessionSecret);
  const dotenv = vars.map(([k, v]) => `${k}=${v}`).join("\n");
  return (
    <ol className="space-y-6">
      <li>
        <h2 className="font-medium">
          1. Create the GitHub App <Check size={16} aria-label="done" className="inline text-accent" />
        </h2>
        <p className="mt-1 text-sm text-muted">
          Created{" "}
          <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="underline hover:text-accent">
            {app.name}
          </a>{" "}
          for @{app.owner.login}.
        </p>
      </li>
      <li>
        <h2 className="font-medium">2. Add its details to Vercel</h2>
        <p className="mt-1 text-sm text-muted">
          In <strong>Vercel → your project → Settings → Environment Variables</strong>, add these. You can also
          paste the whole block into Vercel&apos;s first name box.{" "}
          <strong>Copy them now: this page shows the secret only once.</strong>
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed text-sm" aria-label="Environment variables">
            <tbody className="divide-y divide-border">
              {vars.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className="w-[55%] truncate px-3 py-2 text-left font-mono text-xs font-medium sm:w-[16rem]">
                    {k}
                  </th>
                  <td className="truncate px-3 py-2 font-mono text-xs text-muted">
                    {k.includes("SECRET") ? "•".repeat(12) : v}
                  </td>
                  <td className="w-12 px-2">
                    <CopyButton value={v} label={`Copy ${k}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <CopyButton value={dotenv} label="Copy all" text="Copy all as .env" />
        </div>
        <p className="mt-2 text-xs text-muted">
          ALLOWED_GITHUB_USER_IDS is your GitHub user id, so nobody else can sign in to your deployment.
        </p>
      </li>
      <li>
        <h2 className="font-medium">3. Redeploy, install the app and sign in</h2>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            In Vercel, open <strong>Deployments</strong>, pick the latest and choose <strong>Redeploy</strong>, so it
            picks up the new variables.
          </li>
          <li>
            <a
              href={`https://github.com/apps/${app.slug}/installations/new`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-accent"
            >
              Install the app
            </a>{" "}
            on the repository that will hold your notes. A new, empty private repository is fine.
          </li>
          <li>
            Back in noted-ai, open <strong>Settings → GitHub account</strong>, sign in, then connect the repository
            under <strong>Repositories &amp; sync</strong>.
          </li>
        </ol>
      </li>
    </ol>
  );
}

function CopyButton({ value, label, text }: { value: string; label: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={text ? "button-secondary text-xs" : "icon-button h-8 w-8"}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {text && <span>{copied ? "Copied" : text}</span>}
    </button>
  );
}
