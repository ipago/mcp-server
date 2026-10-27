const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = {
  hooks: {
    preResolution({ lockfileDir }) {
      const script = path.join(lockfileDir, "scripts", "fetch-sdk.mjs");
      const result = spawnSync(process.execPath, [script], {
        cwd: lockfileDir,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`fetch-sdk.mjs exited with status ${result.status}`);
      }
    },
  },
};
