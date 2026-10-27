# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
# The SDK is installed from a git pin. The runtime stage does not need git.
RUN apk add --no-cache git
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src src
RUN pnpm build
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
# Owned by root and world-readable (the build stage's default), so the unprivileged runtime
# user can read the app but cannot modify it.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
WORKDIR /app
# node:22-alpine ships a `node` user (uid 1000). The server only reads files and listens on an
# unprivileged port, so it needs nothing from root.
USER node
EXPOSE 3005
# Use 127.0.0.1, not localhost: busybox wget resolves "localhost" to ::1 first and the server
# listens on IPv4 only.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3005/healthz || exit 1
CMD ["node", "dist/index.js"]
