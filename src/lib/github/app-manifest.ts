/**
 * One-click GitHub App setup, using GitHub's app manifest flow: the browser
 * posts a manifest to GitHub, the user confirms the name, and GitHub sends them
 * back with a one-time code that is swapped for the new app's credentials.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

/** Where GitHub sends the user back to, with `?code=…&state=…`. */
export const SETUP_PATH = "/github-setup";

export interface AppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  request_oauth_on_install: boolean;
  setup_on_update: boolean;
  public: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
}

/**
 * The app noted-ai needs: read and write repository contents, nothing else,
 * no webhooks, private to the account, with sign-in on install.
 */
export function appManifest(origin: string, name: string): AppManifest {
  const base = origin.replace(/\/+$/, "");
  return {
    name: name.trim(),
    url: base,
    hook_attributes: { url: base, active: false },
    redirect_url: base + SETUP_PATH,
    callback_urls: [base + "/api/auth/callback"],
    request_oauth_on_install: true,
    setup_on_update: false,
    public: false,
    default_permissions: { contents: "write" },
    default_events: [],
  };
}

/** A default app name: GitHub app names are global, so add a short random suffix. */
export function defaultAppName(random: () => number = Math.random): string {
  return `noted-ai-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export interface CreatedApp {
  slug: string;
  name: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  owner: { id: number; login: string };
}

/** Swaps the one-time code (valid for an hour) for the new app's credentials. */
export async function convertManifestCode(code: string, fetcher: typeof fetch = fetch): Promise<CreatedApp> {
  if (!/^[\w-]+$/.test(code)) throw new Error("That setup link isn't valid.");
  const res = await fetcher(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404 || res.status === 422
        ? "GitHub didn't accept the setup code. It works once and expires after an hour, so start again."
        : `GitHub returned an error (${res.status}). Try again.`,
    );
  }
  const b = (await res.json()) as {
    slug: string;
    name: string;
    html_url: string;
    client_id: string;
    client_secret: string;
    owner: { id: number; login: string };
  };
  return {
    slug: b.slug,
    name: b.name,
    htmlUrl: b.html_url,
    clientId: b.client_id,
    clientSecret: b.client_secret,
    owner: { id: b.owner.id, login: b.owner.login },
  };
}

/** A random SESSION_SECRET: 32 bytes, base64. */
export function randomSessionSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

/** The environment variables to add in Vercel, in .env.example's order. */
export function envVars(app: CreatedApp, sessionSecret: string): Array<[name: string, value: string]> {
  return [
    ["GITHUB_APP_CLIENT_ID", app.clientId],
    ["GITHUB_APP_CLIENT_SECRET", app.clientSecret],
    ["GITHUB_APP_SLUG", app.slug],
    ["SESSION_SECRET", sessionSecret],
    ["ALLOWED_GITHUB_USER_IDS", String(app.owner.id)],
  ];
}
