// Copies the app's bundled fonts and their licences into fonts/: esbuild keeps
// font-files.ts's `new URL("../fonts/…", import.meta.url)` as is, which from
// dist/main.js points there, and the SIL Open Font License asks for the
// licences to ship with the fonts.
import { cpSync, rmSync } from "node:fs";

rmSync("fonts", { recursive: true, force: true });
cpSync("../../packages/workspace/src/fonts", "fonts", { recursive: true });
