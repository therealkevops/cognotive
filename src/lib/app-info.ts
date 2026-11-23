/** Static facts about the running build, shared by the UI and /api/health. */
export const APP_NAME = "CogNotive.ai";

type Env = Record<string, string | undefined>;

/**
 * The Git commit this build was made from. Vercel sets VERCEL_GIT_COMMIT_SHA on
 * every deployment; locally it is undefined and we report "local".
 */
export function buildCommit(env: Env = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : "local";
}

/** "production", "preview" or "development", following Vercel's VERCEL_ENV. */
export function deploymentEnv(env: Env = process.env): string {
  return env.VERCEL_ENV ?? "development";
}
