// @vitest-environment node
import { describe, expect, it } from "vitest";
import { configureVercel, currentProject, VercelSetupError } from "./vercel-setup";

const PROJECT = { projectId: "prj_1", deploymentId: "dpl_1", projectName: "noted-ai" };
const VARS: Array<[string, string]> = [
  ["GITHUB_APP_CLIENT_ID", "Iv1.abc"],
  ["GITHUB_APP_CLIENT_SECRET", "shh"],
  ["SESSION_SECRET", "s3cret"],
];

/** A fake Vercel API: the project lives in `team` (or the personal account when undefined). */
function fakeVercel(team?: string, opts: { envFails?: boolean; token?: string } = {}) {
  const calls: Array<{ method: string; path: string; teamId: string | null; body?: unknown; auth: string | null }> = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const call = {
      method: init.method ?? "GET",
      path: url.pathname,
      teamId: url.searchParams.get("teamId"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
    };
    calls.push(call);
    if (call.auth !== `Bearer ${opts.token ?? "tok"}`) return Response.json({ error: {} }, { status: 401 });
    const inScope = (call.teamId ?? undefined) === team;
    if (call.path === "/v9/projects/prj_1") return Response.json({}, { status: inScope ? 200 : 404 });
    if (call.path === "/v2/teams") return Response.json({ teams: [{ id: "team_other" }, { id: "team_mine" }] });
    if (call.path === "/v10/projects/prj_1/env") {
      if (!inScope) return Response.json({}, { status: 404 });
      return opts.envFails
        ? Response.json({ failed: [{ error: { message: "nope" } }] }, { status: 400 })
        : Response.json({ created: [], failed: [] }, { status: 201 });
    }
    if (call.path === "/v13/deployments") return Response.json({ url: "noted-ai-abc.vercel.app" });
    return Response.json({}, { status: 404 });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

describe("configureVercel", () => {
  it("saves the variables (secrets as sensitive) and redeploys the current deployment", async () => {
    const v = fakeVercel();
    const r = await configureVercel("tok", PROJECT, VARS, v.fetcher);
    expect(r.deploymentUrl).toBe("https://noted-ai-abc.vercel.app");
    const env = v.calls.find((c) => c.path.endsWith("/env"))!;
    expect(env.method).toBe("POST");
    expect(env.body).toEqual([
      expect.objectContaining({ key: "GITHUB_APP_CLIENT_ID", value: "Iv1.abc", type: "encrypted", target: ["production", "preview"] }),
      expect.objectContaining({ key: "GITHUB_APP_CLIENT_SECRET", type: "sensitive" }),
      expect.objectContaining({ key: "SESSION_SECRET", type: "sensitive" }),
    ]);
    const deploy = v.calls.find((c) => c.path === "/v13/deployments")!;
    expect(deploy.body).toMatchObject({ deploymentId: "dpl_1", target: "production", name: "noted-ai" });
  });

  it("finds the team that owns the project", async () => {
    const v = fakeVercel("team_mine");
    await configureVercel("tok", PROJECT, VARS, v.fetcher);
    expect(v.calls.find((c) => c.path.endsWith("/env"))!.teamId).toBe("team_mine");
    expect(v.calls.find((c) => c.path === "/v13/deployments")!.teamId).toBe("team_mine");
  });

  it("explains a bad token or one without access", async () => {
    await expect(configureVercel("wrong", PROJECT, VARS, fakeVercel().fetcher)).rejects.toThrow(/didn't accept/);
    await expect(configureVercel("tok", PROJECT, VARS, fakeVercel("team_elsewhere").fetcher)).rejects.toThrow(
      /can't reach this project/,
    );
  });

  it("reports when Vercel refuses the variables, without redeploying", async () => {
    const v = fakeVercel(undefined, { envFails: true });
    await expect(configureVercel("tok", PROJECT, VARS, v.fetcher)).rejects.toThrow(/nope/);
    expect(v.calls.some((c) => c.path === "/v13/deployments")).toBe(false);
  });

  it("writes only the GitHub setup variables", async () => {
    const v = fakeVercel();
    await expect(configureVercel("tok", PROJECT, [["NODE_OPTIONS", "--evil"]], v.fetcher)).rejects.toBeInstanceOf(
      VercelSetupError,
    );
    expect(v.calls).toEqual([]);
  });
});

describe("currentProject", () => {
  it("reads Vercel's system variables", () => {
    expect(currentProject({})).toBeNull();
    expect(currentProject({ VERCEL_PROJECT_ID: "prj_1", VERCEL_DEPLOYMENT_ID: "dpl_1" })).toEqual({
      projectId: "prj_1",
      deploymentId: "dpl_1",
      projectName: undefined,
    });
  });
});
