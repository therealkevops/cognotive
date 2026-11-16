/**
 * Adds the GitHub App settings to this Vercel project and redeploys it, with a
 * Vercel access token the user pastes once. The token is used for these few
 * calls and never stored.
 */

const API = "https://api.vercel.com";

/** The only variables setup may write. */
export const SETUP_KEYS = [
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_SLUG",
  "SESSION_SECRET",
  "ALLOWED_GITHUB_USER_IDS",
] as const;
const SECRET_KEYS = new Set(["GITHUB_APP_CLIENT_SECRET", "SESSION_SECRET"]);

export interface VercelProject {
  projectId: string;
  /** The deployment serving this request: the one to redeploy. */
  deploymentId: string;
  projectName?: string;
}

/** This deployment's project, from Vercel's system environment variables; null when not on Vercel. */
export function currentProject(env: Record<string, string | undefined> = process.env): VercelProject | null {
  if (!env.VERCEL_PROJECT_ID || !env.VERCEL_DEPLOYMENT_ID) return null;
  return { projectId: env.VERCEL_PROJECT_ID, deploymentId: env.VERCEL_DEPLOYMENT_ID, projectName: env.VERCEL_PROJECT_NAME };
}

export class VercelSetupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function call(fetcher: Fetch, token: string, path: string, init: RequestInit = {}, teamId?: string) {
  const url = new URL(path, API);
  if (teamId) url.searchParams.set("teamId", teamId);
  return fetcher(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}

/**
 * Finds the scope the project lives in: the token's own account, or one of its
 * teams. Returns the team id, or undefined for the personal account.
 */
async function findScope(fetcher: Fetch, token: string, projectId: string): Promise<string | undefined> {
  const own = await call(fetcher, token, `/v9/projects/${encodeURIComponent(projectId)}`);
  if (own.ok) return undefined;
  if (own.status === 401) throw new VercelSetupError("Vercel didn't accept that token. Check it was copied in full.", 401);
  const teams = await call(fetcher, token, "/v2/teams?limit=100");
  if (teams.ok) {
    const body = (await teams.json()) as { teams?: Array<{ id: string }> };
    for (const t of body.teams ?? []) {
      const r = await call(fetcher, token, `/v9/projects/${encodeURIComponent(projectId)}`, {}, t.id);
      if (r.ok) return t.id;
    }
  }
  throw new VercelSetupError(
    "That token can't reach this project. Create the token in the account or team that owns it, with full access.",
    403,
  );
}

/** Adds or updates the variables, then redeploys production so they take effect. */
export async function configureVercel(
  token: string,
  project: VercelProject,
  vars: Array<[string, string]>,
  fetcher: Fetch = fetch,
): Promise<{ deploymentUrl: string | null }> {
  const allowed = new Set<string>(SETUP_KEYS);
  if (!vars.length || vars.some(([k, v]) => !allowed.has(k) || typeof v !== "string" || !v)) {
    throw new VercelSetupError("Unexpected settings.");
  }
  const teamId = await findScope(fetcher, token, project.projectId);

  const env = await call(
    fetcher,
    token,
    `/v10/projects/${encodeURIComponent(project.projectId)}/env?upsert=true`,
    {
      method: "POST",
      body: JSON.stringify(
        vars.map(([key, value]) => ({
          key,
          value,
          type: SECRET_KEYS.has(key) ? "sensitive" : "encrypted",
          target: ["production", "preview"],
          comment: "Added by noted-ai's GitHub setup",
        })),
      ),
    },
    teamId,
  );
  const envBody = (await env.json().catch(() => ({}))) as { failed?: Array<{ error?: { message?: string } }> };
  if (!env.ok || envBody.failed?.length) {
    const why = envBody.failed?.[0]?.error?.message;
    throw new VercelSetupError(`Vercel didn't save the settings${why ? `: ${why}` : ""}.`, 502);
  }

  const deploy = await call(
    fetcher,
    token,
    "/v13/deployments?forceNew=1",
    {
      method: "POST",
      body: JSON.stringify({
        name: project.projectName ?? project.projectId,
        project: project.projectId,
        deploymentId: project.deploymentId,
        target: "production",
      }),
    },
    teamId,
  );
  if (!deploy.ok) {
    throw new VercelSetupError(
      "The settings are saved, but Vercel didn't start the redeploy. Redeploy from Vercel's Deployments page.",
      502,
    );
  }
  const d = (await deploy.json().catch(() => ({}))) as { url?: string };
  return { deploymentUrl: d.url ? `https://${d.url}` : null };
}
