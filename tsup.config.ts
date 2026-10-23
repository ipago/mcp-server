import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  // @2pay/sdk is private and exports TypeScript source, so it must be bundled.
  noExternal: ["@2pay/sdk"],
  clean: true,
});
