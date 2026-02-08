#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/bump-release-version.mjs <semver>");
  process.exit(1);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

const updateJsonFile = (relativePath, updater) => {
  const filePath = path.join(repoRoot, relativePath);
  const current = JSON.parse(readFileSync(filePath, "utf8"));
  const next = updater(current);
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
};

updateJsonFile("apps/clawcontrol/package.json", (pkg) => ({
  ...pkg,
  version
}));

updateJsonFile("apps/clawcontrol-desktop/package.json", (pkg) => ({
  ...pkg,
  version
}));

updateJsonFile("package-lock.json", (lock) => {
  if (!lock.packages?.["apps/clawcontrol"] || !lock.packages?.["apps/clawcontrol-desktop"]) {
    throw new Error("Expected workspace entries missing in package-lock.json");
  }

  lock.packages["apps/clawcontrol"].version = version;
  lock.packages["apps/clawcontrol-desktop"].version = version;
  return lock;
});

console.log(`Updated workspace versions to ${version}`);
