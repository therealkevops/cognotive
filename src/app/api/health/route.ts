import { APP_NAME, buildCommit, deploymentEnv } from "@/lib/app-info";

// Static: depends only on build-time environment, so it is prerendered and
// served from the CDN without invoking a function (keeps Hobby usage at zero).
export function GET() {
  return Response.json({
    status: "ok",
    app: APP_NAME,
    commit: buildCommit(),
    env: deploymentEnv(),
  });
}
