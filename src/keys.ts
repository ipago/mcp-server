export type KeyMode = "test" | "live";

const KEY_PATTERN = /^Bearer ((?:sk|rk)_(test|live)_[A-Za-z0-9]+)$/;

const LIVE_REFUSAL =
  "This MCP server only accepts test keys (sk_test_...). Live keys are disabled here so an AI assistant cannot touch real money.";

/** Extracts a 2Pay secret (`sk_`) or restricted (`rk_`) key from an Authorization header. Publishable keys are rejected. */
export function readApiKey(authorization: string | undefined): { key: string; mode: KeyMode } | null {
  if (authorization === undefined) return null;
  const m = KEY_PATTERN.exec(authorization);
  if (!m) return null;
  return { key: m[1]!, mode: m[2] === "live" ? "live" : "test" };
}

/** Live keys are refused unless the server was explicitly started with live access allowed. */
export function keyAllowed(
  mode: KeyMode,
  allowLive: boolean,
): { ok: true } | { ok: false; message: string } {
  if (mode === "live" && !allowLive) return { ok: false, message: LIVE_REFUSAL };
  return { ok: true };
}
