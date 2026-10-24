import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TwoPay } from "@2pay/sdk";
import type { createDocsSource } from "./docs.js";
import { keyAllowed, readApiKey } from "./keys.js";
import { buildMcpServer } from "./server.js";

export const MAX_BODY_BYTES = 1_048_576;

type HttpOptions = {
  docs: ReturnType<typeof createDocsSource>;
  apiUrl: string;
  allowLive: boolean;
  fetchImpl?: typeof fetch;
};

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", id: null, error: { code, message } });

export const MALFORMED_AUTH_MESSAGE =
  'The Authorization header must be "Bearer sk_test_..." with a 2Pay secret key. Publishable keys (pk_...) do not work here.';

class BodyTooLarge extends Error {}

/** Reads the request body, aborting as soon as the cap is exceeded. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      req.removeAllListeners("data");
      fn();
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(() => reject(new BodyTooLarge()));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (err) => finish(() => reject(err)));
  });
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, opts: HttpOptions): Promise<void> {
  const rawHeader = req.headers.authorization;
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const parsed = readApiKey(header);
  // No header means a docs-only session. A header that is present but unparseable is a mistake
  // (a typo, a pk_ key, another scheme), so say so instead of silently dropping to docs-only.
  if (header !== undefined && !parsed) {
    sendJson(res, 401, rpcError(-32001, MALFORMED_AUTH_MESSAGE));
    return;
  }
  if (parsed) {
    const verdict = keyAllowed(parsed.mode, opts.allowLive);
    if (!verdict.ok) {
      sendJson(res, 403, rpcError(-32001, verdict.message));
      return;
    }
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      sendJson(res, 413, rpcError(-32600, "Request body too large"), { connection: "close" });
      return;
    }
    throw err;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, rpcError(-32700, "Parse error"));
    return;
  }

  const api = parsed
    ? new TwoPay({ baseUrl: opts.apiUrl, apiKey: parsed.key, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) })
    : null;
  const server = buildMcpServer({ docs: opts.docs, api, mode: parsed?.mode ?? null });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function createHttpHandler(opts: HttpOptions): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const run = async () => {
      if (path === "/healthz" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      } else if (path === "/mcp") {
        if (req.method === "POST") await handleMcp(req, res, opts);
        else sendJson(res, 405, rpcError(-32000, "Method not allowed"), { allow: "POST" });
      } else {
        sendJson(res, 404, { error: "not_found" });
      }
    };
    run().catch((err) => {
      console.error("mcp request failed:", err instanceof Error ? err.message : "unknown error");
      sendJson(res, 500, rpcError(-32603, "Internal server error"));
    });
  };
}
