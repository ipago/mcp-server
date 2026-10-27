import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The SDK dependency exports TypeScript source from node_modules.
    server: {
      deps: {
        inline: ["@ipago/sdk"],
      },
    },
  },
});
