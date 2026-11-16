import { GitHubClient, GitHubError } from "./client";
import type { StoredToken } from "./token-store";

/**
 * Checks a personal access token works and, if a repository is named, can reach
 * it. Returns what to store. Throws with a message for the user.
 */
export async function verifyToken(
  token: string,
  repo?: { owner: string; repo: string },
  fetchFn?: typeof fetch,
): Promise<StoredToken> {
  const t = token.trim();
  if (!t) throw new Error("Paste a token.");
  const client = new GitHubClient(async () => t, fetchFn);
  const who = await client.checkToken();
  if (repo) {
    try {
      await client.listBranches(repo.owner, repo.repo);
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 403)) {
        throw new Error(`That token can't reach ${repo.owner}/${repo.repo}. Give it access to this repository.`);
      }
      throw e;
    }
  }
  return { token: t, login: who.login, expiresAt: who.expiresAt };
}
