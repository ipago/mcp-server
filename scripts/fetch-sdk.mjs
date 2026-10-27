import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ipago/sdk is not on npm. Its package.json publishes `dist`, but the public
// repo only has TypeScript source, and pnpm's git fetcher drops anything outside
// `files`. Download that commit's `packages/sdk` tree instead.
const SHA = "86a0c5185a8ea6955852c7e3206a196b18c65007";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "third_party", "ipago-sdk");
const pinFile = path.join(dest, ".pin");

if (existsSync(path.join(dest, "src", "index.ts")) && existsSync(pinFile) && readFileSync(pinFile, "utf8").trim() === SHA) {
  process.exit(0);
}

const url = `https://codeload.github.com/ipago/ipago-js/tar.gz/${SHA}`;
const tmp = path.join(tmpdir(), `ipago-sdk-${SHA}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const res = await fetch(url);
if (!res.ok) {
  throw new Error(`Download of @ipago/sdk failed: ${url} (${res.status})`);
}
const archive = path.join(tmp, "repo.tgz");
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
execFileSync("tar", ["-xzf", archive, "-C", tmp]);

const extracted = path.join(tmp, `ipago-js-${SHA}`, "packages", "sdk");
if (!existsSync(path.join(extracted, "src", "index.ts"))) {
  throw new Error(`SDK source missing from ${url}`);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(extracted, dest, { recursive: true });
writeFileSync(pinFile, `${SHA}\n`);
rmSync(tmp, { recursive: true, force: true });
console.log(`fetched @ipago/sdk ${SHA}`);
