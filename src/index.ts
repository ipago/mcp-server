import { createServer } from "node:http";
import { createDocsSource } from "./docs.js";
import { createHttpHandler } from "./http.js";

const port = Number(process.env.PORT ?? 3005);
const apiUrl = process.env.TWOPAY_API_URL ?? "http://api:3003";
const docsUrl = process.env.DOCS_URL ?? "https://docs.2pay.gg";
const allowLive = process.env.MCP_ALLOW_LIVE_KEYS === "true";

const server = createServer(
  createHttpHandler({ docs: createDocsSource({ docsUrl }), apiUrl, allowLive }),
);

server.listen(port, () => {
  console.log(`2pay mcp listening on :${port} (api ${apiUrl}, docs ${docsUrl}, live keys ${allowLive ? "allowed" : "refused"})`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
});
