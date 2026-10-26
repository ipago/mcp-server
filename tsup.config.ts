import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  // @ipago/sdk is private and exports TypeScript source, so it must be bundled.
  noExternal: ["@ipago/sdk"],
  clean: true,
});
