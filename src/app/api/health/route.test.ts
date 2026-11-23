import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok with the app name", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok", app: "k-note" });
  });
});
