export type KeyMode = "test" | "live";

// Case-insensitive scheme, one or more whitespace characters, surrounding whitespace trimmed.
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;
// Secret (`sk_`) and restricted (`rk_`) keys are `prefix_<test|live>_<base64url>`.
// The prefix and the mode are case-sensitive. Publishable (`pk_`) keys are rejected.
const KEY_PATTERN = /^(?:sk|rk)_(test|live)_[A-Za-z0-9_-]+$/;

const LIVE_REFUSAL =
  "This MCP server only accepts test keys (sk_test_...). Live keys are disabled here so an AI assistant cannot touch real money.";

/** Extracts an iPago secret (`sk_`) or restricted (`rk_`) key from an Authorization header. Publishable keys are rejected. */
export function readApiKey(authorization: string | undefined): { key: string; mode: KeyMode } | null {
  if (authorization === undefined) return null;
  const bearer = BEARER_PATTERN.exec(authorization.trim());
  if (!bearer) return null;
  const key = bearer[1]!.trim();
  const m = KEY_PATTERN.exec(key);
  if (!m) return null;
  return { key, mode: m[1] === "live" ? "live" : "test" };
}

/** Live keys are refused unless the server was explicitly started with live access allowed. */
export function keyAllowed(
  mode: KeyMode,
  allowLive: boolean,
): { ok: true } | { ok: false; message: string } {
  if (mode === "live" && !allowLive) return { ok: false, message: LIVE_REFUSAL };
  return { ok: true };
}
