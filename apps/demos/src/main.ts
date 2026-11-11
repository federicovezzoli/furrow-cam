import { type ChildProcess, spawn, spawnSync } from "node:child_process";
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

// Placeholders for what env.ts requires: the guest workspace needs no database or email. They
// win over apps/web/.env (Next doesn't override variables already set), but not over the shell.
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
  .map((file) => file.slice(0, -".demo.ts".length))
  // By name, so a demo runs after the one whose output it opens (`step`, then `step-simulation`).
  .sort();
const args = process.argv.slice(2);
// `--no-build` reuses the last build, while working on a script.
const build = !args.includes("--no-build");
// `--speed <factor>` plays the videos faster (or slower), without changing the scripts; 2 by
// default, the pace the website shows. Whole numbers play smoothest: at 1.5, 2 frames in 3 are recorded, so motion steps unevenly.
const speedAt = args.indexOf("--speed");
const speed = speedAt === -1 ? 2 : Number(args[speedAt + 1]);
if (!(speed >= 0.25 && speed <= 16)) {
  console.error(`--speed needs a number from 0.25 to 16, such as --speed 2`);
  process.exit(1);
}
if (speedAt !== -1) args.splice(speedAt, 2);
const names = args.filter((arg) => !arg.startsWith("--"));
for (const flag of args.filter((arg) => arg.startsWith("--") && arg !== "--no-build")) {
  console.error(`Unknown option ${flag}. Options: --no-build, --speed <factor>`);
  process.exit(1);
}
for (const name of names) {
  if (!available.includes(name)) {
    console.error(`No demo "${name}". Demos: ${available.join(", ")}`);
    process.exit(1);
  }
}

if (spawnSync("ffmpeg", ["-version"]).error) {
  console.error("Recording needs ffmpeg on the PATH (https://ffmpeg.org/download.html).");
  process.exit(1);
}

/** The process groups of `next build` and `next start`, stopped however this script ends. */
const groups = new Set<number>();
function stop() {
  for (const group of groups) {
    try {
      process.kill(-group);
    } catch {} // Already stopped.
  }
  groups.clear();
}
process.on("exit", stop);
// Ctrl-C would otherwise end the script without its `exit` event.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(130));

function next(args: string[]) {
  // Its own process group, so stopping it stops the server pnpm starts too.
  const child = spawn("pnpm", ["exec", "next", ...args], {
    cwd: web,
    env,
    stdio: "inherit",
    detached: true,
  });
  if (child.pid) groups.add(child.pid);
  return child;
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
if (build) {
  const [code] = await once(next(["build"]), "exit");
  if (code !== 0) process.exit(code ?? 1);
}
const server = next(["start", "--port", String(port)]);
// The full Chromium draws WebGL on the GPU; the default headless shell uses SwiftShader, on the CPU.
const browser = await chromium.launch({ channel: "chromium" });
try {
  await waitForServer(server);
  for (const name of names.length > 0 ? available.filter((n) => names.includes(n)) : available) {
    console.log(`Recording ${name}…`);
    const demo: { default: (r: Recorder) => Promise<void> } = await import(
      `./demos/${name}.demo.ts`
    );
    const recorder = await Recorder.start(browser, origin, name, output, speed);
    await demo.default(recorder);
    await recorder.finish();
    console.log(`Wrote ${join(output, name)}.mp4, .webm and .jpg`);
  }
} finally {
  await browser.close();
  stop();
}
