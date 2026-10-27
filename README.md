# iPago MCP server

HTTP server that exposes the [iPago](https://ipago.io) documentation and Developer API as [Model Context Protocol](https://modelcontextprotocol.io) tools. Clients connect to `POST /mcp`. A request with no `Authorization` header is documentation-only. A request with `Authorization: Bearer sk_test_...` (or `rk_test_...`) also gets the API tools. Live keys are refused unless the process is started with `MCP_ALLOW_LIVE_KEYS=true`.

The server does not import API internals. Every API call goes through the `@ipago/sdk` HTTP client, using the key the caller sent.

## Requirements

- Node.js 22 or newer
- pnpm 10.33.0 (`packageManager` in `package.json`; Corepack will use it)

## `@ipago/sdk`

`@ipago/sdk` is not published to npm yet. This repo depends on a pinned commit of the public [`ipago/ipago-js`](https://github.com/ipago/ipago-js) repository:

`github:ipago/ipago-js#86a0c5185a8ea6955852c7e3206a196b18c65007&path:/packages/sdk`

That package currently exports TypeScript source, so the production build bundles it. When a semver release is published, replace the git pin with that version.

## Configure

Copy `.env.example` to `.env` and edit it. The file lists variable names and placeholders only. The process reads the environment; it does not load `.env` by itself.

| Variable | Required | Default |
| --- | --- | --- |
| `IPAGO_API_URL` | no | `https://api.ipago.io` |
| `DOCS_URL` | no | `https://docs.ipago.io` |
| `PORT` | no | `3005` |
| `MCP_ALLOW_LIVE_KEYS` | no | unset (live keys refused). Set to `true` to allow them. |

API keys are not configuration. Each client sends its own `Bearer` key.

## Scripts

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
pnpm dev
```

`pnpm build` writes `dist/index.js`. `pnpm start` runs that file. `GET /healthz` returns `ok`.

## Container

The image is `ghcr.io/ipago/mcp-server`. It listens on port 3005 as the unprivileged `node` user.

```bash
docker build -t mcp-server .
docker run --rm -p 3005:3005 -e IPAGO_API_URL=https://api.ipago.io mcp-server
```

GitHub Actions pushes `:<full sha>` and `:<short sha>` on pull requests and on `main`, and `:latest` only on `main`.
