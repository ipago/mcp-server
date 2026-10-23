import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpHandler } from "./http.js";

const servers: Server[] = [];

async function start(allowLive = false) {
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
  const docs = {
    pages: vi.fn(async () => []),
    page: vi.fn(async () => ""),
  };
  const handler = createHttpHandler({
    docs: docs as never,
    apiUrl: "http://api.invalid",
    allowLive,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, fetchImpl };
}

async function listTools(base: string, auth?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: auth ? { headers: { Authorization: auth } } : {},
  });
  const client = new Client({ name: "t", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("http entrypoint", () => {
  it("lists only docs tools without a key", async () => {
    const { base } = await start();
    expect(await listTools(base)).toHaveLength(2);
  });

  it("lists the full tool set with a test key", async () => {
    const { base } = await start();
    const tools = await listTools(base, "Bearer sk_test_x");
    expect(tools.length).toBeGreaterThan(2);
  });

  it("refuses a live key with a JSON-RPC 403 and never calls the API", async () => {
    const { base, fetchImpl } = await start(false);
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer sk_live_x",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { jsonrpc: string; id: null; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toContain("sk_test_");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 413 for a body over 1 MB", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "x".repeat(2 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("answers 400 with a parse error for malformed JSON", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{nope",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("serves /healthz", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers 405 for GET and DELETE /mcp and 404 elsewhere", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
