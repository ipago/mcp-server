import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TwoPayError, type TwoPay } from "@2pay/sdk";
import { z } from "zod";
import { isSafeDocSlug, searchDocs, type createDocsSource } from "./docs.js";
import type { KeyMode } from "./keys.js";

export type McpContext = {
  docs: ReturnType<typeof createDocsSource>;
  api: TwoPay | null;
  mode: KeyMode | null;
  allowLive: boolean;
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function describeError(err: unknown): string {
  if (err instanceof TwoPayError) {
    const e = (err.body as { error?: { code?: unknown; message?: unknown } } | null | undefined)?.error;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return `2Pay API error ${err.status} (${e.code}): ${e.message}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const listShape = {
  limit: z.number().int().min(1).max(100).optional().describe("Page size, 1 to 100"),
  starting_after: z.string().optional().describe("Cursor: id of the last object of the previous page"),
};

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "2pay", version: "0.1.0" });

  server.registerTool(
    "search_docs",
    {
      description: "Searches the 2Pay documentation and returns matching pages with url, title and excerpt.",
      inputSchema: { query: z.string().min(1).describe("Search terms") },
    },
    async ({ query }) => {
      try {
        return ok(searchDocs(await ctx.docs.pages(), query));
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "get_doc_page",
    {
      description: "Returns the full markdown of one 2Pay documentation page, given a slug such as dev/checkout.",
      inputSchema: { slug: z.string().describe("Doc page slug, for example dev/checkout") },
    },
    async ({ slug }) => {
      if (!isSafeDocSlug(slug)) return fail("Unsafe doc slug: use a slug under dev/ or creators/, like dev/checkout.");
      try {
        return { content: [{ type: "text", text: await ctx.docs.page(slug) }] };
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  const api = ctx.api;
  if (!api) return server;

  function apiTool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    call: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ): void {
    // The generic shape cannot be threaded through registerTool's conditional callback type.
    const handler = async (args: z.infer<z.ZodObject<S>>): Promise<ToolResult> => {
      try {
        return ok(await call(args));
      } catch (err) {
        return fail(describeError(err));
      }
    };
    server.registerTool(name, { description, inputSchema: shape }, handler as never);
  }

  const id = (what: string) => ({ id: z.string().min(1).describe(`${what} id`) });
  const status = z.string().optional().describe("Filter by status");

  apiTool("list_products", "Returns a page of the store's products with prices.", {
    ...listShape,
    active: z.enum(["true", "false"]).optional().describe("Filter by active flag"),
    category: z.string().optional().describe("Filter by category id"),
  }, (a) => api.products.list(a));
  apiTool("get_product", "Returns one product by id.", id("Product"), (a) => api.products.retrieve(a.id));

  apiTool(
    "create_checkout",
    "Creates a checkout session for the given products and returns it, including the hosted payment URL.",
    {
      items: z
        .array(z.object({ product: z.string().min(1), quantity: z.number().int().min(1).optional() }))
        .min(1)
        .describe("Products to buy"),
      customer_email: z.string().email().optional(),
      country: z.string().length(2).optional().describe("Customer ISO 3166-1 alpha-2 country code"),
    },
    (a) => api.checkouts.create(a, { idempotencyKey: randomUUID() }),
  );

  apiTool("list_orders", "Returns a page of orders.", { ...listShape, status }, (a) => api.orders.list(a));
  apiTool("get_order", "Returns one order by id.", id("Order"), (a) => api.orders.retrieve(a.id));
  apiTool("get_balance", "Returns the current account balance.", {}, () => api.balance.retrieve());
  apiTool("list_deliveries", "Returns a page of fulfilment deliveries.", { ...listShape, status }, (a) =>
    api.deliveries.list(a));
  apiTool("list_events", "Returns a page of API events.", listShape, (a) => api.events.list(a));
  apiTool("get_event", "Returns one API event by id.", id("Event"), (a) => api.events.retrieve(a.id));
  apiTool("list_webhook_endpoints", "Returns a page of webhook endpoints.", listShape, (a) =>
    api.webhookEndpoints.list(a));
  apiTool(
    "create_webhook_endpoint",
    "Creates a webhook endpoint and returns it including its signing secret, which is shown once and cannot be retrieved later.",
    { url: z.string().url().describe("HTTPS URL that receives events"), events: z.array(z.string()).optional() },
    (a) => api.webhookEndpoints.create(a),
  );
  apiTool(
    "send_test_event",
    "Sends a test event to a webhook endpoint and returns the delivery result.",
    { endpoint_id: z.string().min(1).describe("Webhook endpoint id") },
    (a) => api.events.sendTest(a.endpoint_id),
  );
  apiTool("list_refunds", "Returns a page of refunds.", { ...listShape, status }, (a) => api.refunds.list(a));
  apiTool("list_disputes", "Returns a page of disputes.", { ...listShape, status }, (a) => api.disputes.list(a));
  apiTool("list_payouts", "Returns a page of payouts.", { ...listShape, status }, (a) => api.payouts.list(a));

  if (ctx.mode === "test") {
    apiTool(
      "create_refund",
      "Refunds an order (test mode only) and returns the refund.",
      { order: z.string().min(1).describe("Order id"), reason: z.string().optional() },
      (a) => api.refunds.create(a, { idempotencyKey: randomUUID() }),
    );
  }

  return server;
}
