import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright";

const FPS = 60;
const WIDTH = 1920;
const HEIGHT = 1080;
/** The page's clock starts here on every run, so dates and timers match between runs. */
const START = new Date("2026-01-01T09:00:00Z");

/** A cursor drawn by the page, since screenshots don't show the real one. */
const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const cursor = document.createElement("div");
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px)";
  addEventListener("pointermove", (event) => {
    cursor.style.left = event.clientX + "px";
    cursor.style.top = event.clientY + "px";
  }, true);
  // The last pointer event the page handled, which the recorder waits for.
  for (const type of ["pointermove", "pointerdown", "pointerup"]) {
    addEventListener(type, (event) => {
      window.demoMouse = type + " " + event.clientX + "," + event.clientY;
    }, true);
  }
  // Wheel events the page handled, which the recorder waits for.
  window.demoWheels = 0;
  addEventListener("wheel", () => window.demoWheels++, true);
  document.body.append(cursor);
});
`;

function run(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: "inherit" });
  return once(child, "exit").then(([code]) => {
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
  });
}

/** A video being recorded: the page, a frame at a time, piped into ffmpeg. */
export class Recorder {
  readonly page: Page;
  readonly #name: string;
  readonly #output: string;
  readonly #ffmpeg: ChildProcess;
  readonly #mouse = { x: WIDTH / 2, y: HEIGHT / 2 };
  readonly #speed: number;
  /** Frames the page clock has advanced, recorded or not (see `frame`). */
  #ticks = 0;
  #last: Buffer | null = null;
  #poster: Buffer | null = null;

  private constructor(
    name: string,
    output: string,
    page: Page,
    ffmpeg: ChildProcess,
    speed: number,
  ) {
    this.#name = name;
    this.#speed = speed;
    this.#output = output;
    this.page = page;
    this.#ffmpeg = ffmpeg;
  }

  /**
   * Opens a fresh dark, English, 1920 × 1080 page on a frozen clock (ADR-0075).
   * Requests leave only for `origin`, so nothing (such as telemetry) depends on the network.
   */
  static async start(browser: Browser, origin: string, name: string, output: string, speed = 1) {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: WIDTH, height: HEIGHT },
      colorScheme: "dark",
      locale: "en-US",
    });
    await context.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    );
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    await page.clock.install({ time: START });
    await page.clock.pauseAt(START.getTime() + 1000);
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        String(FPS),
        "-i",
        "-",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "slow",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        // Renamed once finished, so a failed run never leaves a cut-off video.
        join(output, `${name}.part.mp4`),
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    // If ffmpeg dies, writing to it fails; the next frame() reports that it stopped.
    ffmpeg.stdin?.on("error", () => {});
    return new Recorder(name, output, page, ffmpeg, speed);
  }

  /**
   * Lets the page reach `urls` on the network, past the route that refuses
   * other origins: for a demo that needs outside services (the terrain's
   * map). What they answer can change between runs (PRD-0013).
   */
  async allow(urls: RegExp) {
    await this.page.context().route(urls, (route) => route.continue());
  }

  /**
   * The element marked `data-tour` or `data-demo` with `name`, or a form field
   * with that id. A missing anchor stops the run, naming the video and the
   * anchor (PRD-0013 D2).
   */
  async anchor(name: string): Promise<Locator> {
    const locator = this.#locate(name);
    try {
      await locator.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      throw new Error(`Demo "${this.#name}": anchor "${name}" not found`);
    }
    return locator;
  }

  #locate(name: string) {
    return this.page
      .locator(`[data-tour="${name}"], [data-demo="${name}"], [id="${name}"]`)
      .filter({ visible: true })
      .first();
  }

  /**
   * Stops the run unless `count` paths are selected: a click that missed its
   * path would otherwise record a wrong video.
   */
  async expectSelected(count: number) {
    const selected = Number(await (await this.anchor("selection")).getAttribute("data-count"));
    if (selected !== count) {
      throw new Error(`Demo "${this.#name}": expected ${count} selected paths, got ${selected}`);
    }
  }

  /** Stops the run if an operation in the list shows toolpath warnings. */
  async expectNoWarnings() {
    const shown = await this.page
      .locator('[data-demo="toolpath-warning"]')
      .filter({ visible: true })
      .count();
    if (shown > 0) throw new Error(`Demo "${this.#name}": ${shown} operations show warnings`);
  }

  /**
   * Opens a new project in the workspace without an account (PRD-0008), or
   * the project file `project` (imported in the guest's project list), and
   * skips the guided tour, whose overlay would catch the mouse. Records nothing.
   */
  async openWorkspace(project?: string) {
    if (project) {
      await this.page.goto("/projects");
      // The list shows once the page is interactive.
      await this.waitForWork(
        this.page.getByRole("table").or(this.page.getByText("No projects yet")),
      );
      const box = await (await this.anchor("import-project")).boundingBox();
      if (!box) throw new Error(`Demo "${this.#name}": anchor "import-project" not found`);
      await this.#pickFile(project, () =>
        this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
      );
    } else {
      await this.page.goto("/new");
    }
    const tour = this.page.getByRole("dialog");
    // An import the list refuses shows its error (`FormError`; Next.js's route announcer is a `role="alert"` too).
    const refused = this.page.locator('[data-slot="alert"]');
    await this.waitForWork(project ? tour.or(refused) : tour);
    if (project && (await refused.isVisible())) {
      throw new Error(`Demo "${this.#name}": ${await refused.textContent()}`);
    }
    await this.page.keyboard.press("Escape");
    await this.page.clock.runFor(500);
    await tour.waitFor({ state: "hidden" });
    await this.waitForWork(this.page.locator('[data-tour="viewport"] canvas'));
    // WebGL starts up in real time: give the 3D view frames to draw its first one.
    for (let i = 0; i < FPS; i++) await this.#step();
    // The page's mouse starts at the corner: bring it, and the drawn cursor, to where #mouse says.
    await this.page.mouse.move(this.#mouse.x, this.#mouse.y);
    await this.#handled("pointermove");
    await this.#align();
  }

  /**
   * Advances the page clock by one frame and records it as many times as
   * `speed` asks: at 2, every other frame isn't recorded (nor screenshotted);
   * at 0.5, each is recorded twice.
   */
  async frame() {
    await this.page.clock.runFor(1000 / FPS);
    this.#ticks++;
    const copies =
      Math.floor(this.#ticks / this.#speed) - Math.floor((this.#ticks - 1) / this.#speed);
    if (copies === 0) return;
    await this.#swept();
    this.#last = await this.#screenshot();
    const stdin = this.#ffmpeg.stdin;
    if (!stdin || this.#ffmpeg.exitCode !== null) {
      throw new Error(`ffmpeg stopped while recording ${this.#name}`);
    }
    for (let i = 0; i < copies; i++) {
      if (!stdin.write(this.#last)) await once(stdin, "drain");
    }
  }

  /**
   * Waits, in real time, for the simulator's worker to sweep the stock up to
   * the playback, so every run records it alike (ADR-0075).
   */
  async #swept(timeout = 120_000) {
    const sweeping = this.page.locator('[data-demo="playback-sweeping"]');
    const end = Date.now() + timeout;
    // React commits the flag on its own scheduler (a MessageChannel, which the
    // page clock doesn't fake): a message posted now arrives after that commit.
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage(null);
        }),
    );
    while ((await sweeping.count()) > 0) {
      if (Date.now() > end) {
        throw new Error(`Demo "${this.#name}": timed out waiting for the simulation's worker`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Headless Chromium now and then never answers a screenshot; asking again gets it. */
  async #screenshot(attempt = 1): Promise<Buffer> {
    try {
      return await this.page.screenshot({
        type: "jpeg",
        quality: 95,
        animations: "disabled",
        timeout: 5_000,
      });
    } catch (error) {
      if (attempt >= 3) throw error;
      return this.#screenshot(attempt + 1);
    }
  }

  /** Makes the last frame recorded the poster, instead of the video's last frame. */
  poster() {
    this.#poster = this.#last;
  }

  /** Records `seconds` of the page as it is. */
  async hold(seconds: number) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) await this.frame();
  }

  /** Glides the cursor to (`x`, `y`) over `seconds`, easing in and out. */
  async moveToPoint(x: number, y: number, seconds = 0.6) {
    const from = { ...this.#mouse };
    const frames = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.#move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased);
      await this.frame();
    }
  }

  /**
   * Moves the mouse to whole pixels and waits until the page has the move:
   * Chrome hands moves to the page on its next real frame, which would
   * otherwise land on a different video frame from one run to the next.
   */
  async #move(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x === this.#mouse.x && y === this.#mouse.y) return;
    this.#mouse.x = x;
    this.#mouse.y = y;
    await this.page.mouse.move(x, y);
    await this.#handled("pointermove");
  }

  async #press(button: "down" | "up") {
    await this.page.mouse[button]();
    await this.#handled(`pointer${button}`);
  }

  /** Waits until the page has handled a pointer event `type` at the cursor's position. */
  async #handled(type: string) {
    const expected = `${type} ${this.#mouse.x},${this.#mouse.y}`;
    const end = Date.now() + 5_000;
    while (
      (await this.page.evaluate(() => (window as { demoMouse?: string }).demoMouse)) !== expected
    ) {
      if (Date.now() > end) throw new Error(`Demo "${this.#name}": the page missed a ${type}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  /** Glides the cursor to the middle of the anchor `name`. */
  async moveTo(name: string, seconds?: number) {
    const anchor = await this.anchor(name);
    // Inside a scrolled pane, the anchor can be out of sight: the pane scrolls to it, as for a user.
    await anchor.scrollIntoViewIfNeeded();
    const box = await anchor.boundingBox();
    if (!box) throw new Error(`Demo "${this.#name}": anchor "${name}" has no box`);
    await this.moveToPoint(box.x + box.width / 2, box.y + box.height / 2, seconds);
    return box;
  }

  /**
   * Moves to the anchor `name` and clicks it, with a short pause either side.
   * With `waitFor`, the work the click starts is waited for before the pause
   * after it, until that anchor shows (see `waitForWork`); with `waitForGone`,
   * first until that anchor is gone (see `waitForGone`).
   */
  async click(
    name: string,
    { waitFor, waitForGone }: { waitFor?: string; waitForGone?: string } = {},
  ) {
    await this.moveTo(name);
    await this.#clickHere(waitFor, waitForGone);
  }

  /**
   * Clicks `[x, y]` pixels from the anchor `name`'s top left corner: for
   * what has no anchor of its own, such as a path in the viewport (measure it
   * on a recorded frame). With `shift`, adds to the selection.
   */
  async clickIn(name: string, [x, y]: readonly [number, number], { shift = false } = {}) {
    const box = await (await this.anchor(name)).boundingBox();
    if (!box) throw new Error(`Demo "${this.#name}": anchor "${name}" has no box`);
    await this.moveToPoint(box.x + x, box.y + y);
    if (shift) await this.page.keyboard.down("Shift");
    try {
      await this.#clickHere();
    } finally {
      if (shift) await this.page.keyboard.up("Shift");
    }
  }

  async #clickHere(waitFor?: string, waitForGone?: string) {
    await this.hold(0.2);
    await this.#press("down");
    await this.frame();
    await this.#press("up");
    if (waitForGone) await this.waitForGone(waitForGone);
    if (waitFor) await this.waitForWork(waitFor);
    await this.hold(0.4);
  }

  /**
   * Moves to the select `name` and picks the option labelled `label`. The
   * native list isn't in screenshots, so the choice just appears.
   */
  async select(name: string, label: string, { waitFor }: { waitFor?: string } = {}) {
    await this.moveTo(name);
    const field = await this.anchor(name);
    await this.hold(0.3);
    await field.selectOption({ label });
    if (waitFor) await this.waitForWork(waitFor);
    await this.hold(0.5);
  }

  /**
   * Clicks the anchor `name`, which downloads a project file, and saves it in
   * the output folder as `<video name>.furrow.zip` (or `.furrow.json`), for a
   * later video to open. Returns its path.
   */
  async saveDownload(name: string) {
    const [download] = await Promise.all([this.page.waitForEvent("download"), this.click(name)]);
    const suggested = download.suggestedFilename();
    const extension = [".furrow.zip", ".furrow.json"].find((end) => suggested.endsWith(end));
    if (!extension) throw new Error(`Demo "${this.#name}": unexpected download ${suggested}`);
    const file = join(this.#output, this.#name + extension);
    await download.saveAs(file);
    return file;
  }

  /** Clicks the anchor `name`, which opens a file picker, and picks `file`. */
  async chooseFile(name: string, file: string) {
    await this.#pickFile(file, () => this.click(name));
  }

  /** Picks `file` in the file picker that `click` opens. */
  async #pickFile(file: string, click: () => Promise<unknown>) {
    const [chooser] = await Promise.all([this.page.waitForEvent("filechooser"), click()]);
    await chooser.setFiles(file);
  }

  /**
   * Clicks the field `name`, selects what it holds, types `text` a letter at
   * a time and presses `press`; `waitFor` as for `click`.
   */
  async type(
    name: string,
    text: string,
    { press = "Enter", waitFor }: { press?: string; waitFor?: string } = {},
  ) {
    await this.click(name);
    await this.page.keyboard.press("ControlOrMeta+A");
    await this.frame();
    for (const letter of text) {
      await this.page.keyboard.type(letter);
      await this.hold(0.06);
    }
    await this.page.keyboard.press(press);
    if (waitFor) await this.waitForWork(waitFor);
    await this.hold(0.3);
  }

  /** Drags from the cursor's position by (`dx`, `dy`) over `seconds`, e.g. to orbit the 3D view. */
  async drag(dx: number, dy: number, seconds: number) {
    await this.#press("down");
    await this.moveToPoint(this.#mouse.x + dx, this.#mouse.y + dy, seconds);
    await this.#press("up");
  }

  /**
   * Turns the mouse wheel `notches` at the cursor, spread over `seconds`, e.g.
   * to zoom the 3D view (negative zooms in). Its controls zoom a fixed step a
   * wheel event, whatever the delta, so the count sets how far. Each is
   * handled before the frame is recorded.
   */
  async wheel(notches: number, seconds: number) {
    const frames = Math.max(1, Math.round(seconds * FPS));
    const count = Math.abs(notches);
    const handled = () => this.page.evaluate(() => (window as { demoWheels?: number }).demoWheels);
    for (let i = 0; i < frames; i++) {
      if (Math.floor(((i + 1) * count) / frames) > Math.floor((i * count) / frames)) {
        const before = await handled();
        await this.page.mouse.wheel(0, Math.sign(notches) * 100);
        const end = Date.now() + 5_000;
        while ((await handled()) === before) {
          if (Date.now() > end) throw new Error(`Demo "${this.#name}": the page missed a wheel`);
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }
      await this.frame();
    }
  }

  /**
   * Runs the page clock, recording nothing, until `target` (a locator or an
   * anchor's name) is visible: for
   * workers to finish, so the video cuts straight to the result (PRD-0013).
   */
  async waitForWork(target: Locator | string, timeout = 120_000) {
    const locator = typeof target === "string" ? this.#locate(target) : target;
    const end = Date.now() + timeout;
    const failed = this.page.locator('[data-demo="toolpath-failed"]').filter({ visible: true });
    while (!(await locator.isVisible())) {
      if ((await failed.count()) > 0) {
        throw new Error(`Demo "${this.#name}": a toolpath failed while waiting for ${target}`);
      }
      if (Date.now() > end)
        throw new Error(`Demo "${this.#name}": timed out waiting for ${locator}`);
      await this.#step();
    }
    await this.#align();
  }

  /**
   * Runs the page clock, recording nothing, until the anchor `name` is gone:
   * for work that ends by closing a form, before what it changes is waited for.
   */
  async waitForGone(name: string, timeout = 120_000) {
    const locator = this.#locate(name);
    const end = Date.now() + timeout;
    while (await locator.isVisible()) {
      if (Date.now() > end) throw new Error(`Demo "${this.#name}": anchor "${name}" never closed`);
      await this.#step();
    }
  }

  /**
   * Waiting took a varying number of steps: jump to the next whole second, so
   * the fake animation frames (every 16 ms) fall alike against the video's
   * frames on every run, and the camera's damping moves alike (ADR-0075).
   */
  async #align() {
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(Math.ceil(now / 1000) * 1000 + 1000);
  }

  /** Advances the page clock by one frame without recording it, and lets real time pass. */
  async #step() {
    await this.page.clock.runFor(1000 / FPS);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  /** Finishes the MP4, then writes the WebM (VP9) and the poster (see `poster`). */
  async finish() {
    this.#ffmpeg.stdin?.end();
    const code = this.#ffmpeg.exitCode ?? (await once(this.#ffmpeg, "exit"))[0];
    await this.page.context().close();
    if (code !== 0) throw new Error(`ffmpeg exited with ${code} for ${this.#name}`);
    const mp4 = join(this.#output, `${this.#name}.mp4`);
    await rename(join(this.#output, `${this.#name}.part.mp4`), mp4);
    const poster = this.#poster ?? this.#last;
    if (poster) await writeFile(join(this.#output, `${this.#name}.jpg`), poster);
    // shortcut: one-pass constant quality; switch to two-pass with a bitrate if a video goes over 10 MB.
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      mp4,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "34",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      join(this.#output, `${this.#name}.webm`),
    ]);
  }
}
