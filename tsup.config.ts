import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  // @ipago/sdk is not published yet and its package exports TypeScript source.
  // Bundle it so the image talks to the API through that client without shipping the source tree.
  noExternal: ["@ipago/sdk"],
  clean: true,
});
