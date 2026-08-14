#!/usr/bin/env node
// libsodium-wrappers ships an ESM entry that does `import from "./libsodium.mjs"`
// but the sibling file is never packed — it lives in the peer `libsodium`
// package. Under pnpm's strict layout Node's ESM resolver 404s at runtime
// (tsx seed, tsx server). Vitest hides this with a resolve alias.
// This script materializes the missing sibling as a one-line re-export.
import { readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pnpmRoot = join(process.cwd(), "node_modules", ".pnpm");
if (!existsSync(pnpmRoot)) process.exit(0);

const targets = readdirSync(pnpmRoot).filter((d) =>
  d.startsWith("libsodium-wrappers@"),
);

for (const dir of targets) {
  const modulesEsm = join(
    pnpmRoot,
    dir,
    "node_modules",
    "libsodium-wrappers",
    "dist",
    "modules-esm",
  );
  if (!existsSync(modulesEsm) || !statSync(modulesEsm).isDirectory()) continue;
  const shim = join(modulesEsm, "libsodium.mjs");
  if (existsSync(shim)) continue;
  writeFileSync(shim, 'export { default } from "libsodium";\n');
  console.log(`patched ${shim}`);
}
