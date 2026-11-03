import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Recorder } from "./recorder.ts";

/**
 * `pnpm demos [name…]`: builds and starts the web app, then records every
 * demo in `src/demos/` (or the named ones) into `output/` (PRD-0013, ADR-0075).
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, "..", "web");
const output = join(root, "output");
const port = 3100;
const origin = `http://localhost:${port}`;

// Placeholders so the build passes env validation without an apps/web/.env: the guest workspace needs no database.
const env = {
  DATABASE_URL: "postgresql://demos:demos@localhost:5432/demos",
  BETTER_AUTH_SECRET: "demos-placeholder-secret-at-least-32-chars",
  BETTER_AUTH_URL: origin,
  EMAIL_FROM: "Furrow CAM <noreply@example.com>",
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
};

const available = (await readdir(join(root, "src", "demos")))
  .filter((file) => file.endsWith(".demo.ts"))
  .map((file) => file.slice(0, -".demo.ts".length));
const names = process.argv.slice(2);
for (const name of names) {
  if (!available.includes(name)) {
    console.error(`No demo "${name}". Demos: ${available.join(", ")}`);
    process.exit(1);
  }
}

function next(args: string[]) {
  // Its own process group, so stopping it stops the server pnpm starts too.
  return spawn("pnpm", ["exec", "next", ...args], {
    cwd: web,
    env,
    stdio: "inherit",
    detached: true,
  });
}

async function waitForServer(server: ChildProcess) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("The web app stopped");
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The web app didn't start on ${origin}`);
}

// Another server on the port (say, one a crashed run left behind) would pass the start-up check with an old build.
if (
  await fetch(origin).then(
    () => true,
    () => false,
  )
) {
  console.error(`Port ${port} is in use: stop whatever runs on ${origin} first.`);
  process.exit(1);
}

await mkdir(output, { recursive: true });
const [code] = await once(next(["build"]), "exit");
if (code !== 0) process.exit(code ?? 1);
const server = next(["start", "--port", String(port)]);
const browser = await chromium.launch();
try {
  await waitForServer(server);
  for (const name of names.length > 0 ? names : available) {
    console.log(`Recording ${name}…`);
    const demo: { default: (r: Recorder) => Promise<void> } = await import(
      `./demos/${name}.demo.ts`
    );
    const recorder = await Recorder.start(browser, origin, name, output);
    await demo.default(recorder);
    await recorder.finish();
    console.log(`Wrote ${join(output, name)}.mp4, .webm and .jpg`);
  }
} finally {
  await browser.close();
  if (server.pid) process.kill(-server.pid);
}
