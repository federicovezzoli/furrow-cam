// Writes dist/THIRD-PARTY-NOTICES.txt: the licence of every package bundled
// into dist/main.js, which their terms require to ship with it. Reads (then
// removes) the metafile esbuild wrote to dist/meta.json.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const meta = JSON.parse(readFileSync("dist/meta.json", "utf8"));
rmSync("dist/meta.json");

// The last node_modules/<name> or node_modules/@scope/<name> in each input's path.
const PACKAGE_DIR = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//;
const dirs = new Set(
  Object.keys(meta.inputs).flatMap((input) => PACKAGE_DIR.exec(input)?.[1] ?? []),
);

const notices = [];
for (const dir of [...dirs].sort()) {
  const { name, version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  // Furrow CAM's own packages are under its LICENSE, shipped beside this file.
  if (name.startsWith("@furrow/")) continue;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  if (!file && !license) throw new Error(`${name} has no licence to include`);
  const text = file ? readFileSync(join(dir, file), "utf8").trim() : `License: ${license}`;
  notices.push(`${name}@${version}\n\n${text}`);
}
if (notices.length === 0) throw new Error("No bundled packages found in the metafile");

writeFileSync(
  "dist/THIRD-PARTY-NOTICES.txt",
  `dist/main.js bundles the following packages, under these licences.\n\n${notices.join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
);
console.log(`dist/THIRD-PARTY-NOTICES.txt: ${notices.length} packages`);
