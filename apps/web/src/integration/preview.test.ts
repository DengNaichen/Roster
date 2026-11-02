import { describe, expect, it } from "vitest";
import { isLocalPreview } from "./preview";
describe("local preview boundary", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "::1"])(
    "allows explicit development preview on %s",
    (hostname) => {
      expect(isLocalPreview(true, "true", hostname)).toBe(true);
    },
  );
  it("never bypasses authentication in production even with the flag set", () => {
    expect(isLocalPreview(false, "true", "localhost")).toBe(false);
    expect(isLocalPreview(false, "true", "127.0.0.1")).toBe(false);
  });
  it.each(["roster.example.com", "localhost.example.com", "127.0.0.1.example.com", ""])(
    "rejects remote or unknown host %s",
    (hostname) => {
      expect(isLocalPreview(true, "true", hostname)).toBe(false);
    },
  );
  it.each([undefined, "false", "TRUE", ""])("requires literal opt-in %s", (flag) => {
    expect(isLocalPreview(true, flag, "localhost")).toBe(false);
  });
});
