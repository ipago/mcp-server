export type KeyMode = "test" | "live";

// Same scheme parsing as the API (apps/api/src/http/auth.ts): case-insensitive scheme,
// one or more whitespace characters, surrounding whitespace trimmed.
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;
// Keys are `sk_<mode>_<base64url>` (apps/api/src/kernel/secret.ts). The prefix is case-sensitive.
const KEY_PATTERN = /^(?:sk|rk)_(test|live)_[A-Za-z0-9_-]+$/;

const LIVE_REFUSAL =
  "This MCP server only accepts test keys (sk_test_...). Live keys are disabled here so an AI assistant cannot touch real money.";

/** Extracts a 2Pay secret (`sk_`) or restricted (`rk_`) key from an Authorization header. Publishable keys are rejected. */
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
