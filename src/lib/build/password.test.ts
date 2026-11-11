import { describe, expect, it } from "vitest";
import { hashRootPassword } from "./password";

describe("hashRootPassword", () => {
  it("produces a SHA-512 crypt hash and keeps the password off the command line", async () => {
    const hash = await hashRootPassword("correct horse", { salt: "abcdefgh" });
    expect(hash).toMatch(/^\$6\$abcdefgh\$[./0-9A-Za-z]{86}$/);
    expect(hash).not.toContain("correct horse");
  });
});
