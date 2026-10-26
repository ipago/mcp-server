# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/mcp/package.json apps/mcp/package.json
# @ipago/sdk is a workspace dependency that exports TypeScript source; tsup bundles it.
COPY packages/sdk/package.json packages/sdk/package.json
RUN pnpm install --filter @ipago/mcp... --frozen-lockfile
COPY packages/sdk packages/sdk
COPY apps/mcp apps/mcp
RUN pnpm --filter @ipago/mcp build
RUN pnpm install --filter @ipago/mcp --prod --frozen-lockfile --config.confirmModulesPurge=false

FROM base AS runtime
ENV NODE_ENV=production
# Owned by root and world-readable (the build stage's default), so the unprivileged runtime
# user can read the app but cannot modify it.
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/mcp/node_modules /repo/apps/mcp/node_modules
COPY --from=build /repo/apps/mcp/dist /repo/apps/mcp/dist
COPY --from=build /repo/apps/mcp/package.json /repo/apps/mcp/package.json
WORKDIR /repo/apps/mcp
# node:22-alpine ships a `node` user (uid 1000). The server only reads files and listens on an
# unprivileged port, so it needs nothing from root.
USER node
EXPOSE 3005
# Use 127.0.0.1, not localhost: busybox wget resolves "localhost" to ::1 first and the server
# listens on IPv4 only.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3005/healthz || exit 1
CMD ["node", "dist/index.js"]
