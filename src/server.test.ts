import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { IPagoError, type IPago } from "@ipago/sdk";
import { buildMcpServer } from "./server.js";
import type { KeyMode } from "./keys.js";

function fakeDocs() {
  return {
    pages: vi.fn(async () => [
      { url: "https://docs.ipago.io/dev/checkout/overview", title: "Checkout", body: "Create a checkout session." },
    ]),
    page: vi.fn(async (slug: string) => `# page ${slug}`),
  };
}

function fakeApi() {
  const list = () => vi.fn(async () => ({ object: "list", data: [], has_more: false }));
  return {
    products: { list: list(), retrieve: vi.fn(async (id: string) => ({ id })) },
    checkouts: { create: vi.fn(async () => ({ id: "co_1", url: "https://pay" })) },
    orders: { list: list(), retrieve: vi.fn(async (id: string) => ({ id, status: "paid" })) },
    balance: { retrieve: vi.fn(async () => ({ available: 1 })) },
    deliveries: { list: list() },
    events: { list: list(), retrieve: vi.fn(async (id: string) => ({ id })), sendTest: vi.fn(async () => ({ ok: true })) },
    webhookEndpoints: { list: list(), create: vi.fn(async () => ({ id: "we_1", secret: "whsec_x" })) },
    refunds: { list: list(), create: vi.fn(async () => ({ id: "re_1" })) },
    disputes: { list: list() },
    payouts: { list: list() },
  };
}

async function connect(opts: {
  api?: ReturnType<typeof fakeApi> | null;
  mode?: KeyMode | null;
  docs?: ReturnType<typeof fakeDocs>;
}) {
  const docs = opts.docs ?? fakeDocs();
  const api = opts.api === undefined ? null : opts.api;
  const server = buildMcpServer({
    docs: docs as never,
    api: api as unknown as IPago | null,
    mode: opts.mode ?? null,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, docs, api };
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe("buildMcpServer", () => {
  it("lists only docs tools without an api", async () => {
    const { client } = await connect({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_doc_page", "search_docs"]);
  });

  it("lists all api tools in test mode including create_refund", async () => {
    const { client } = await connect({ api: fakeApi(), mode: "test" });
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of [
      "search_docs", "get_doc_page", "list_products", "get_product", "create_checkout", "list_orders",
      "get_order", "get_balance", "list_deliveries", "list_events", "get_event", "list_webhook_endpoints",
      "create_webhook_endpoint", "send_test_event", "list_refunds", "list_disputes", "list_payouts", "create_refund",
    ]) expect(names).toContain(n);
    for (const t of tools) expect(t.description).toBeTruthy();
    expect(tools.find((t) => t.name === "create_webhook_endpoint")!.description).toMatch(/once/i);
  });

  it("omits create_refund in live mode", async () => {
    const { client } = await connect({ api: fakeApi(), mode: "live" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_order");
    expect(names).not.toContain("create_refund");
  });

  it("returns the api JSON as text", async () => {
    const { client } = await connect({ api: fakeApi(), mode: "test" });
    const r = await client.callTool({ name: "get_order", arguments: { id: "ord_1" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe(JSON.stringify({ id: "ord_1", status: "paid" }, null, 2));
  });

  it("turns IPagoError into an error result and keeps serving", async () => {
    const api = fakeApi();
    api.orders.retrieve.mockRejectedValueOnce(
      new IPagoError(403, { error: { type: "permission_error", code: "insufficient_scope", message: "Key lacks orders:read" } }),
    );
    const { client } = await connect({ api, mode: "test" });
    const bad = await client.callTool({ name: "get_order", arguments: { id: "ord_1" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("insufficient_scope");
    expect(text(bad)).toContain("Key lacks orders:read");
    const ok = await client.callTool({ name: "get_order", arguments: { id: "ord_2" } });
    expect(ok.isError).toBeFalsy();
  });

  it("turns non-API errors into error results", async () => {
    const api = fakeApi();
    api.balance.retrieve.mockRejectedValueOnce(new Error("socket hang up"));
    const { client } = await connect({ api, mode: "test" });
    const r = await client.callTool({ name: "get_balance", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("socket hang up");
  });

  it("refuses unsafe doc slugs without calling the docs source", async () => {
    const { client, docs } = await connect({});
    const r = await client.callTool({ name: "get_doc_page", arguments: { slug: "../x" } });
    expect(r.isError).toBe(true);
    expect(docs.page).not.toHaveBeenCalled();
    const ok = await client.callTool({ name: "get_doc_page", arguments: { slug: "dev/checkout/overview" } });
    expect(text(ok)).toContain("# page dev/checkout/overview");
  });

  it("searches docs", async () => {
    const { client } = await connect({});
    const r = await client.callTool({ name: "search_docs", arguments: { query: "checkout" } });
    expect(text(r)).toContain("https://docs.ipago.io/dev/checkout/overview");
  });

  it("sends an Idempotency-Key with create_checkout", async () => {
    const api = fakeApi();
    const { client } = await connect({ api, mode: "test" });
    await client.callTool({
      name: "create_checkout",
      arguments: { items: [{ product: "prod_1", quantity: 2 }], customer_email: "a@b.co" },
    });
    expect(api.checkouts.create).toHaveBeenCalledWith(
      { items: [{ product: "prod_1", quantity: 2 }], customer_email: "a@b.co" },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
  });

  it("passes list pagination and filters through, and rejects bad limits", async () => {
    const api = fakeApi();
    const { client } = await connect({ api, mode: "test" });
    await client.callTool({ name: "list_orders", arguments: { status: "paid", limit: 5, starting_after: "ord_9" } });
    expect(api.orders.list).toHaveBeenCalledWith({ status: "paid", limit: 5, starting_after: "ord_9" });
    const bad = await client.callTool({ name: "list_orders", arguments: { limit: 500 } });
    expect(bad.isError).toBe(true);
  });

  it("rejects id inputs that are not plain ids, without calling the api", async () => {
    const api = fakeApi();
    const { client } = await connect({ api, mode: "test" });
    const r = await client.callTool({ name: "get_product", arguments: { id: "../orders" } });
    expect(r.isError).toBe(true);
    expect(api.products.retrieve).not.toHaveBeenCalled();
    for (const [name, args] of [
      ["get_order", { id: "ord_1/../../balance" }],
      ["send_test_event", { endpoint_id: "we_1?x=1" }],
      ["create_refund", { order: "../ord_1" }],
      ["list_orders", { starting_after: "a/b" }],
      ["create_checkout", { items: [{ product: "../x" }] }],
      ["get_event", { id: "e".repeat(101) }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError, name).toBe(true);
    }
    expect(api.orders.retrieve).not.toHaveBeenCalled();
    expect(api.events.sendTest).not.toHaveBeenCalled();
    expect(api.refunds.create).not.toHaveBeenCalled();
    expect(api.orders.list).not.toHaveBeenCalled();
    expect(api.checkouts.create).not.toHaveBeenCalled();
    expect(api.events.retrieve).not.toHaveBeenCalled();
    expect(text(await client.callTool({ name: "get_product", arguments: { id: "prod_01J9ZX" } }))).toContain("prod_01J9ZX");
  });

  it("creates refunds with an idempotency key and webhooks via the sdk", async () => {
    const api = fakeApi();
    const { client } = await connect({ api, mode: "test" });
    await client.callTool({ name: "create_refund", arguments: { order: "ord_1", reason: "requested" } });
    expect(api.refunds.create).toHaveBeenCalledWith(
      { order: "ord_1", reason: "requested" },
      { idempotencyKey: expect.any(String) },
    );
    await client.callTool({ name: "create_webhook_endpoint", arguments: { url: "https://x.test/h", events: ["order.paid"] } });
    expect(api.webhookEndpoints.create).toHaveBeenCalledWith({ url: "https://x.test/h", events: ["order.paid"] });
    await client.callTool({ name: "send_test_event", arguments: { endpoint_id: "we_1" } });
    expect(api.events.sendTest).toHaveBeenCalledWith("we_1");
  });
});
