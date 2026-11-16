"use client";

import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
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
        <h2 className="font-medium">2. Save it to Vercel</h2>
        <p className="mt-1 text-sm">With a Vercel token you paste once, noted-ai does this for you.</p>
      </li>
      <li className="text-muted">
        <h2 className="font-medium">3. Redeploy</h2>
      </li>
      <li className="text-muted">
        <h2 className="font-medium">4. Choose a repository and sign in</h2>
      </li>
    </ol>
  );
}

type VercelStep =
  | { kind: "token" }
  | { kind: "saving" }
  | { kind: "redeploying"; since: number }
  | { kind: "ready" }
  | { kind: "slow" };

/** How long to wait for the redeploy before suggesting a look at Vercel. */
const REDEPLOY_PATIENCE_MS = 6 * 60 * 1000;

function Created({ app, sessionSecret }: { app: CreatedApp; sessionSecret: string }) {
  const vars = envVars(app, sessionSecret);
  const [token, setToken] = useState("");
  const [step, setStep] = useState<VercelStep>({ kind: "token" });
  const [error, setError] = useState<string | null>(null);

  // After the redeploy starts, wait until this address answers with GitHub set up.
  useEffect(() => {
    if (step.kind !== "redeploying") return;
    const t = setInterval(() => {
      void fetch("/api/auth/token", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ configured?: boolean }>)
        .then((b) => {
          if (b.configured !== false) setStep({ kind: "ready" });
          else if (Date.now() - step.since > REDEPLOY_PATIENCE_MS) setStep({ kind: "slow" });
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [step]);

  const save = async () => {
    setStep({ kind: "saving" });
    setError(null);
    try {
      const res = await fetch("/api/setup/vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, vars }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Setup failed (${res.status}).`);
      setToken("");
      setStep({ kind: "redeploying", since: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "token" });
    }
  };

  const done = (n: number) => (
    <>
      {n}. <Check size={16} aria-label="done" className="inline text-accent" />
    </>
  );

  return (
    <ol className="space-y-6">
      <li>
        <h2 className="font-medium">{done(1)} Create the GitHub App</h2>
        <p className="mt-1 text-sm text-muted">
          Created{" "}
          <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="underline hover:text-accent">
            {app.name}
          </a>{" "}
          for @{app.owner.login}.
        </p>
      </li>
      <li>
        <h2 className="font-medium">
          {step.kind === "token" || step.kind === "saving" ? "2." : done(2)} Save it to Vercel
        </h2>
        {(step.kind === "token" || step.kind === "saving") && (
          <>
            <p className="mt-1 text-sm text-muted">
              noted-ai can add the settings to this Vercel project and redeploy it for you.{" "}
              <a
                href="https://vercel.com/account/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                Create a Vercel token
              </a>{" "}
              (scope: the account or team that owns this project; expiry: 1 day is plenty) and paste it here. It&apos;s
              used once and not kept.
            </p>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim() && step.kind === "token") void save();
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                Vercel token
                <input
                  className="input font-mono"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <button type="submit" className="button-primary" disabled={!token.trim() || step.kind === "saving"}>
                {step.kind === "saving" ? "Saving…" : "Save and redeploy"}
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </>
        )}
        {step.kind !== "token" && step.kind !== "saving" && (
          <p className="mt-1 text-sm text-muted">Settings saved to Vercel.</p>
        )}
        {(step.kind === "token" || step.kind === "saving" || step.kind === "slow") && (
          <ManualVars vars={vars} open={!!error || step.kind === "slow"} />
        )}
      </li>
      <li>
        <h2 className="font-medium">{step.kind === "ready" ? done(3) : "3."} Redeploy</h2>
        {step.kind === "redeploying" && (
          <p className="mt-1 flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 size={14} aria-hidden className="animate-spin" /> Vercel is redeploying. This usually takes a
            minute or two; this page carries on by itself.
          </p>
        )}
        {step.kind === "slow" && (
          <p className="mt-1 text-sm text-muted" role="status">
            The new deployment isn&apos;t live yet. Check <strong>Deployments</strong> in Vercel, then reload this page.
          </p>
        )}
        {step.kind === "ready" && <p className="mt-1 text-sm text-muted">The new deployment is live.</p>}
      </li>
      <li>
        <h2 className="font-medium">4. Choose a repository and sign in</h2>
        <p className="mt-1 text-sm text-muted">
          Pick the repository that will hold your notes; a new, empty private one is fine. GitHub then brings you back,
          signed in.
        </p>
        {step.kind === "ready" ? (
          <a href="/api/auth/install" className="button-primary mt-3 inline-flex">
            Choose a repository on GitHub <ExternalLink size={14} aria-hidden />
          </a>
        ) : (
          <p className="mt-2 text-xs text-muted">Available once the redeploy is live.</p>
        )}
      </li>
    </ol>
  );
}

/** The settings, to add in Vercel by hand. */
function ManualVars({ vars, open }: { vars: Array<[string, string]>; open: boolean }) {
  const dotenv = vars.map(([k, v]) => `${k}=${v}`).join("\n");
  return (
    <details className="mt-4 text-sm" open={open}>
      <summary className="cursor-pointer text-muted hover:text-foreground">Or add them in Vercel by hand</summary>
      <p className="mt-2 text-muted">
        In <strong>Vercel → your project → Settings → Environment Variables</strong>, add these (or paste the whole
        block into the first name box), then redeploy. <strong>This page shows the secrets only once.</strong>
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
    </details>
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
