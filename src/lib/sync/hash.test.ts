import { describe, expect, it } from "vitest";
import { gitBlobSha } from "./hash";

describe("gitBlobSha", () => {
  it("matches git hash-object", async () => {
    // printf '' | git hash-object --stdin ; printf 'hello\n' | git hash-object --stdin
    expect(await gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(await gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("counts bytes, not characters", async () => {
    // printf 'café' | git hash-object --stdin
    expect(await gitBlobSha("café")).toBe("1c2e52cfe7542a64cdea57e5fec2fc1739846c03");
  });
});
