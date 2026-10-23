import { describe, expect, it } from "vitest";
import { keyAllowed, readApiKey } from "./keys.js";

const LIVE_MESSAGE =
  "This MCP server only accepts test keys (sk_test_...). Live keys are disabled here so an AI assistant cannot touch real money.";

describe("readApiKey", () => {
  it.each([
    ["Bearer sk_test_abc123", "sk_test_abc123", "test"],
    ["Bearer sk_live_abc123", "sk_live_abc123", "live"],
    ["Bearer rk_test_abc123", "rk_test_abc123", "test"],
    ["Bearer rk_live_abc123", "rk_live_abc123", "live"],
  ] as const)("parses %s", (header, key, mode) => {
    expect(readApiKey(header)).toEqual({ key, mode });
  });

  it.each([
    ["missing header", undefined],
    ["empty header", ""],
    ["Basic scheme", "Basic sk_test_abc123"],
    ["publishable test key", "Bearer pk_test_abc123"],
    ["publishable live key", "Bearer pk_live_abc123"],
    ["unknown prefix", "Bearer sk_other_abc123"],
    ["uppercase prefix", "Bearer SK_TEST_abc123"],
    ["bare prefix without body", "Bearer sk_test_"],
    ["bare key without scheme", "sk_test_abc123"],
    ["extra whitespace", "Bearer  sk_test_abc123"],
  ])("returns null for %s", (_label, header) => {
    expect(readApiKey(header)).toBeNull();
  });
});

describe("keyAllowed", () => {
  it("refuses live keys when live is disabled, with the exact message", () => {
    expect(keyAllowed("live", false)).toEqual({ ok: false, message: LIVE_MESSAGE });
  });

  it("allows live keys when live is enabled", () => {
    expect(keyAllowed("live", true)).toEqual({ ok: true });
  });

  it("allows test keys when live is disabled", () => {
    expect(keyAllowed("test", false)).toEqual({ ok: true });
  });

  it("allows test keys when live is enabled", () => {
    expect(keyAllowed("test", true)).toEqual({ ok: true });
  });
});
