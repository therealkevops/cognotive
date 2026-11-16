import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/server/github-oauth";
import { configureVercel, currentProject, VercelSetupError } from "@/lib/server/vercel-setup";

const noStore = { "Cache-Control": "no-store" };

/**
 * One-time setup: saves the new GitHub App's settings to this Vercel project
 * and redeploys. Only works while GitHub isn't set up yet, so once it is, this
 * route can't change anything. The Vercel token is used and dropped.
 */
export async function POST(request: NextRequest) {
  const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });
  if (authConfig()) return fail("GitHub is already set up on this deployment.", 409);
  const project = currentProject();
  if (!project) return fail("This isn't running on Vercel, so the settings can't be added automatically.", 400);

  let body: { token?: unknown; vars?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Bad request.");
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const vars = Array.isArray(body.vars) ? (body.vars as Array<[string, string]>) : [];
  if (!token) return fail("Paste a Vercel access token.");

  try {
    const result = await configureVercel(token, project, vars);
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    if (e instanceof VercelSetupError) return fail(e.message, e.status);
    console.error("Vercel setup failed:", e instanceof Error ? e.message : e);
    return fail("Couldn't reach Vercel. Try again.", 502);
  }
}
