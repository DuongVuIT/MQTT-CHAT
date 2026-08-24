#!/usr/bin/env node
/**
 * pnpm hoists RN build tooling into the root .pnpm store, but the RN gradle
 * plugin and codegen CLI expect to live at <app>/node_modules/@react-native/*.
 * This hook restores those links after every install.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..", "apps", "mobile");
const repoRoot = path.resolve(__dirname, "..");
const rnDir = path.join(appRoot, "node_modules", "@react-native");

fs.mkdirSync(rnDir, { recursive: true });

for (const pkg of ["gradle-plugin", "codegen"]) {
  const dest = path.join(rnDir, pkg);
  if (fs.existsSync(path.join(dest, "package.json"))) continue;
  const pattern = path.join(
    repoRoot,
    "node_modules",
    ".pnpm",
    `@react-native+${pkg}@*`,
    "node_modules",
    "@react-native",
    pkg,
  );
  const found = execSync(`ls -d ${pattern} 2>/dev/null | head -1`, { encoding: "utf8" }).trim();
  if (!found) {
    console.warn(`[mobile-postinstall] ${pkg} not found in pnpm store — skipping`);
    continue;
  }
  fs.symlinkSync(found, dest, "dir");
  console.log(`[mobile-postinstall] linked ${pkg}`);
}
