import { readFile } from "node:fs/promises";
import { release as osRelease } from "node:os";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { translator } from "@furrow/ui/lib/i18n";
import { isLocale, type Locale, matchLocale } from "@furrow/ui/lib/locales";
import { blankReportUrl } from "@furrow/workspace/lib/bug-report";
import {
  captureError,
  parseTelemetryEvent,
  posthogHost,
  setTelemetrySink,
  type TelemetryEvent,
  track,
} from "@furrow/workspace/lib/telemetry";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
// The session electron-updater makes its requests in; not exported from the package root.
import { getNetSession } from "electron-updater/out/electronHttpExecutor";
import { PostHog } from "posthog-node";
import {
  CHANNELS,
  type DataFile,
  type FileStamp,
  type MenuCommand,
  OPEN_EXTENSIONS,
  type Recovery,
  type UnsavedChoice,
} from "../shared/api";
import {
  existingRecent,
  fileStamp,
  parseRecent,
  projectName,
  projectPathsIn,
  readJson,
  recoveryStore,
  withRecent,
  writeFileAtomic,
  writeJson,
} from "./files";
import {
  addServer,
  CLAUDE_CODE_COMMAND,
  claudeCodeInstalled,
  clientStatus,
  type McpClient,
  mcpClients,
} from "./mcp-setup";
import { parseTelemetryPrefs, type TelemetryPrefs } from "./telemetry";
import {
  isUpdateRequest,
  latestDesktopRelease,
  newerRelease,
  parseUpdatePrefs,
  RELEASES_URL,
  type Release,
  releasePage,
  type UpdatePrefs,
} from "./updates";

/** In development the renderer comes from electron-vite's dev server. */
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
/** The built renderer, next to `package.json` (or inside the app's archive). */
const rendererDir = () => join(app.getAppPath(), "out/renderer");
const APP_ORIGIN = "app://furrow";

/**
 * The renderer only loads its own files: no connections leave the app
 * (ADR-0044, PRD-0007 D2). Workers and the viewport's textures use blobs;
 * STEP import compiles OpenCascade's bundled WebAssembly (ADR-0072).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DATA_FILES: readonly DataFile[] = ["tools", "machines", "settings"];

// Standard and secure, so module workers and `import.meta.url` resolve as on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const dataDir = () => app.getPath("userData");
const recoveries = () => recoveryStore(join(dataDir(), "recovery"));
const recentPath = () => join(dataDir(), "recent.json");
/** Kept apart from `settings.json`, which the renderer rewrites as a whole. */
const updatesPath = () => join(dataDir(), "updates.json");
/** An in-memory session for the update check alone (ADR-0048). */
const UPDATE_PARTITION = "updates";
const telemetryPath = () => join(dataDir(), "telemetry.json");
/** The language picked in the app (ADR-0054), apart from `settings.json` as `updates.json` is. */
const localePath = () => join(dataDir(), "locale.json");
/** An in-memory session for usage statistics and error reports alone (ADR-0052). */
const TELEMETRY_PARTITION = "telemetry";
/** Set at build time; without it the app never asks or sends anything. */
const POSTHOG_KEY = process.env.POSTHOG_KEY || null;
/** Our proxy domain, or PostHog's EU cloud; also set at build time. */
const POSTHOG_URL = posthogHost(process.env.POSTHOG_HOST);
/** Anonymous: a new ID each launch, never stored. */
const LAUNCH_ID = crypto.randomUUID();

let window: BrowserWindow | null = null;
/** Set by the window's own state: whether the open project has unsaved changes. */
let modified = false;
/** The renderer handled unsaved changes; the next close goes through. */
let closeAllowed = false;
let quitting = false;
/** The close the renderer is handling started as a quit, which goes on once it's done. */
let quitAfterClose = false;
/** The quit under way is *Restart Now*: install this downloaded release, then start again. */
let installOnQuit: Release | null = null;
/** As `quitAfterClose`, for `installOnQuit`. */
let installAfterClose: Release | null = null;
/** Files to open that arrived before the renderer asked for them. */
let pendingPaths: string[] = projectPathsIn(process.argv.slice(1));
let updatePrefs: UpdatePrefs = {};
/** Writes of `updates.json`, in order, so the last choice is also the one on disk. */
let prefsWrite = Promise.resolve();
/** The request in flight, shared by the start-up check and the menu. */
let releaseCheck: Promise<Release | null> | null = null;
/** An update dialog is open: another would repeat it. */
let updateDialogOpen = false;
/** The release being downloaded, outside the dialogs (ADR-0074). */
let downloading: Release | null = null;
let telemetryPrefs: TelemetryPrefs = {};
/** Writes of `telemetry.json`, in order, as `prefsWrite`. */
let telemetryWrite = Promise.resolve();
/** Running only while the user agrees. */
let posthog: PostHog | null = null;
/** The language picked in the app; `null` follows the system's. */
let pickedLocale: Locale | null = null;

// The main process's events and errors, the renderer's included, go through the shared
// module, so each error is sent once and a session sends a limited number (ADR-0052).
setTelemetrySink({
  track: trackEvent,
  error: (error) => posthog?.captureException(error, LAUNCH_ID, appProperties()),
});
// Observes uncaught errors without changing how they're handled. In Node's default mode an
// unhandled rejection is raised as one, so it's seen here too.
process.on("uncaughtExceptionMonitor", (error) => captureError(error));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    for (const path of projectPathsIn(argv.slice(1))) openPath(path);
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  // macOS: a double-clicked file, possibly before the app is ready.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    openPath(path);
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  // Sends what's queued, for at most two seconds, before the app quits; then installs the
  // update if the user chose Restart Now.
  app.on("will-quit", (event) => {
    const client = posthog;
    if (client) {
      posthog = null;
      event.preventDefault();
      void client.shutdown(2_000).finally(() => app.quit());
    } else if (installOnQuit) {
      const release = installOnQuit;
      installOnQuit = null;
      event.preventDefault();
      installAndRestart(release);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" || quitting) app.quit();
  });
  app.on("activate", () => {
    if (!window && app.isReady()) createWindow();
  });
  void app.whenReady().then(async () => {
    if (!DEV_URL) serveRenderer();
    blockNetwork();
    registerIpc();
    updatePrefs = parseUpdatePrefs(await readJson(updatesPath()));
    telemetryPrefs = parseTelemetryPrefs(await readJson(telemetryPath()));
    const saved = (await readJson(localePath())) as { picked?: unknown } | null;
    pickedLocale = isLocale(saved?.picked) ? saved.picked : null;
    applyTelemetry();
    if (installsUpdates()) {
      // Nothing downloads until the user agrees to the update.
      autoUpdater.autoDownload = false;
      autoUpdater.on("download-progress", ({ percent }) => window?.setProgressBar(percent / 100));
    }
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    window?.once("ready-to-show", async () => {
      // The update check runs whatever happens to the telemetry question.
      await askAboutTelemetry().catch(() => {});
      await startupUpdateCheck();
    });
  });
}

function openPath(path: string) {
  if (window && !window.webContents.isLoading()) window.webContents.send(CHANNELS.openPath, path);
  else pendingPaths.push(path);
  if (!window && app.isReady()) createWindow();
}

/** Serves the built renderer from `app://furrow/`, refusing paths outside it. */
function serveRenderer() {
  protocol.handle("app", async (request) => {
    const { host, pathname } = new URL(request.url);
    const root = rendererDir();
    const file = normalize(join(root, decodeURIComponent(pathname)));
    const inside = relative(root, file);
    if (host !== "furrow" || inside.startsWith("..") || inside.startsWith(sep)) {
      return new Response("Not found", { status: 404 });
    }
    const target = extname(file) === "" ? join(root, "index.html") : file;
    const response = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Cancels every request to the network: the app works offline (PRD-0007 D2).
 * The only exceptions are the update check's own session, which reaches the
 * releases list and nothing else (ADR-0048), electron-updater's, which reaches
 * the update endpoint and the release files (ADR-0074), and telemetry's, which
 * reaches only PostHog (ADR-0052).
 */
function blockNetwork() {
  if (DEV_URL) return;
  const filter = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] };
  // The default session serves the app's only window.
  session.defaultSession.webRequest.onBeforeRequest(filter, (_details, callback) =>
    callback({ cancel: true }),
  );
  session
    .fromPartition(UPDATE_PARTITION)
    .webRequest.onBeforeRequest(filter, (details, callback) =>
      callback({ cancel: details.url !== RELEASES_URL }),
    );
  const updater = getNetSession();
  updater.webRequest.onBeforeRequest(filter, (details, callback) =>
    callback({ cancel: !isUpdateRequest(details.url) }),
  );
  // electron-updater sends an ID it keeps on disk with every check; nothing may identify the
  // user (ADR-0013).
  updater.webRequest.onBeforeSendHeaders(filter, ({ requestHeaders }, callback) => {
    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase() === "x-user-staging-id") delete requestHeaders[name];
    }
    callback({ requestHeaders });
  });
  session
    .fromPartition(TELEMETRY_PARTITION)
    .webRequest.onBeforeRequest(filter, (details, callback) =>
      // Also refuses what was queued before the user turned telemetry off.
      callback({ cancel: !telemetryPrefs.enabled || !details.url.startsWith(`${POSTHOG_URL}/`) }),
    );
}

/** Starts or stops sending to match the user's choice. */
function applyTelemetry() {
  if (POSTHOG_KEY && telemetryPrefs.enabled) {
    posthog ??= new PostHog(POSTHOG_KEY, {
      host: POSTHOG_URL,
      // Through telemetry's own session, never Node's network stack.
      fetch: (url, options) => session.fromPartition(TELEMETRY_PARTITION).fetch(url, options),
    });
  } else if (posthog) {
    void posthog.shutdown();
    posthog = null;
  }
}

/** Properties of every event: none of them about the user. */
function appProperties() {
  return { $process_person_profile: false, $os: process.platform, $app_version: app.getVersion() };
}

function trackEvent({ event, ...properties }: TelemetryEvent) {
  posthog?.capture({
    distinctId: LAUNCH_ID,
    event,
    properties: { ...properties, ...appProperties() },
  });
}

/** Asks once whether to send usage statistics and error reports. */
async function askAboutTelemetry() {
  if (!POSTHOG_KEY || telemetryPrefs.enabled !== undefined) return;
  const t = tr();
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: t("DesktopMain.telemetry.question"),
    detail: t("DesktopMain.telemetry.detail"),
    buttons: [t("DesktopMain.telemetry.send"), t("DesktopMain.telemetry.dontSend")],
    defaultId: 0,
    cancelId: 1,
  });
  await saveTelemetryPrefs({ enabled: response === 0 });
  Menu.setApplicationMenu(buildMenu());
}

/** Applies the choice at once and saves it; a failed save keeps it until the app quits. */
function saveTelemetryPrefs(change: TelemetryPrefs) {
  telemetryPrefs = { ...telemetryPrefs, ...change };
  applyTelemetry();
  const prefs = telemetryPrefs;
  telemetryWrite = telemetryWrite
    .then(() => writeJson(telemetryPath(), prefs))
    .catch((error: unknown) => warnUnsaved("telemetry", error));
  return telemetryWrite;
}

/** Says that a choice couldn't be saved and only lasts until the app quits. */
async function warnUnsaved(what: "updates" | "telemetry" | "language", error: unknown) {
  const t = tr();
  const detail = t("DesktopMain.unsaved.detail");
  await dialog.showMessageBox({
    type: "warning",
    message: t("DesktopMain.unsaved.title", { what }),
    detail: error instanceof Error ? `${detail}\n\n${error.message}` : detail,
    buttons: [t("DesktopMain.unsaved.ok")],
  });
}

/** The newest desktop release on GitHub; throws when it can't be reached. */
async function fetchLatestRelease() {
  const response = await session.fromPartition(UPDATE_PARTITION).fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return latestDesktopRelease(await response.json());
}

/**
 * Windows and Linux download and install updates themselves; macOS only opens the release
 * page, as Squirrel.Mac refuses an unsigned app (ADR-0074). Also false when not packaged,
 * and for an AppImage's unpacked files.
 */
function installsUpdates() {
  return process.platform !== "darwin" && autoUpdater.isUpdaterActive();
}

/** A newer release from the update endpoint; throws when it can't be reached. */
async function checkUpdater(): Promise<Release | null> {
  const result = await autoUpdater.checkForUpdates();
  if (!result?.isUpdateAvailable) return null;
  const { version } = result.updateInfo;
  return { version, url: releasePage(version) };
}

/** A newer release than the running app, or `null`; throws when it can't be reached. */
function checkForRelease() {
  releaseCheck ??= (
    installsUpdates()
      ? checkUpdater()
      : fetchLatestRelease().then((latest) => newerRelease(app.getVersion(), latest))
  ).finally(() => {
    releaseCheck = null;
  });
  return releaseCheck;
}

/** Changes the choice at once and saves it; a failed save keeps it until the app quits. */
function saveUpdatePrefs(change: UpdatePrefs) {
  updatePrefs = { ...updatePrefs, ...change };
  const prefs = updatePrefs;
  prefsWrite = prefsWrite
    .then(() => writeJson(updatesPath(), prefs))
    .catch((error: unknown) => warnUnsaved("updates", error));
  return prefsWrite;
}

/** Shows `dialogs` unless another update dialog is open, so a notice never appears twice. */
async function withUpdateDialog(dialogs: () => Promise<void>) {
  if (updateDialogOpen) return;
  updateDialogOpen = true;
  try {
    await dialogs();
  } finally {
    updateDialogOpen = false;
  }
}

/** Asks once whether to check at start-up, then checks quietly if allowed. */
async function startupUpdateCheck() {
  if (updatePrefs.checkAtStartup === undefined) {
    const t = tr();
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: t("DesktopMain.updates.question"),
      detail: t("DesktopMain.updates.detail"),
      buttons: [t("DesktopMain.updates.checkAtStartup"), t("DesktopMain.updates.dontCheck")],
      defaultId: 0,
      cancelId: 1,
    });
    await saveUpdatePrefs({ checkAtStartup: response === 0 });
    Menu.setApplicationMenu(buildMenu());
  }
  if (!updatePrefs.checkAtStartup) return;
  let release: Release | null;
  try {
    release = await checkForRelease();
  } catch {
    // Offline, or GitHub is unavailable: the next start tries again.
    return;
  }
  if (release && release.version !== updatePrefs.skippedVersion) {
    const offered = release;
    await withUpdateDialog(() => offerRelease(offered));
  }
}

/** The MCP server's setup guide, for clients the app can't set up itself. */
const MCP_GUIDE = "https://github.com/federicovezzoli/furrow-cam/tree/main/apps/mcp#readme";

/**
 * Help → Set Up AI Assistants… (PRD-0012 M12): finds the MCP clients on this
 * computer, asks, and adds the local MCP server to the ones that don't have
 * it. Only this process touches their files (ADR-0044). Claude Code's file
 * isn't edited: the user gets its command to run.
 */
async function setUpAssistants() {
  const t = tr();
  const list = (clients: McpClient[]) =>
    new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(
      clients.map((client) => client.name),
    );
  const [found, claudeCode] = await Promise.all([
    Promise.all(
      mcpClients().map(async (client) => ({ client, status: await clientStatus(client) })),
    ),
    claudeCodeInstalled(),
  ]);
  const having = (status: string) =>
    found.filter((each) => each.status === status).map(({ client }) => client);
  const ready = having("ready");
  const added = having("added");
  const unreadable = having("unreadable");
  const notes = [
    added.length > 0 ? t("DesktopMain.assistants.already", { clients: list(added) }) : "",
    unreadable.length > 0
      ? t("DesktopMain.assistants.unreadable", { clients: list(unreadable) })
      : "",
  ].filter(Boolean);
  const claudeCodeNote = claudeCode
    ? [t("DesktopMain.assistants.claudeCode", { command: CLAUDE_CODE_COMMAND })]
    : [];

  /** The last dialog: OK, with Copy Command if Claude Code is here and the guide if asked. */
  const finish = async (
    options: Pick<MessageBoxOptions, "type" | "message">,
    detail: string[],
    guide: boolean,
  ) => {
    const buttons = [
      t("DesktopMain.assistants.ok"),
      ...(claudeCode ? [t("DesktopMain.assistants.copyCommand")] : []),
      ...(guide ? [t("DesktopMain.assistants.guide")] : []),
    ];
    const { response } = await dialog.showMessageBox({
      ...options,
      detail: [...detail, ...claudeCodeNote].join("\n\n"),
      buttons,
      defaultId: 0,
      cancelId: 0,
    });
    // Copy Command is right after OK, the guide last.
    if (claudeCode && response === 1) clipboard.writeText(CLAUDE_CODE_COMMAND);
    else if (guide && response === buttons.length - 1) void shell.openExternal(MCP_GUIDE);
  };

  if (ready.length === 0) {
    const message =
      added.length > 0 || unreadable.length > 0 || claudeCode
        ? t("DesktopMain.assistants.nothingToAdd")
        : t("DesktopMain.assistants.none");
    await finish({ type: "info", message }, [...notes, t("DesktopMain.assistants.others")], true);
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: "question",
    message: t("DesktopMain.assistants.question", { clients: list(ready) }),
    detail: [t("DesktopMain.assistants.detail"), ...notes].join("\n\n"),
    buttons: [t("DesktopMain.assistants.add"), t("DesktopMain.assistants.cancel")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  const failed: McpClient[] = [];
  for (const client of ready) {
    try {
      await addServer(client);
    } catch (error) {
      console.warn(`Couldn't add the MCP server to ${client.name}:`, error);
      failed.push(client);
    }
  }
  const done = ready.filter((client) => !failed.includes(client));
  const failure = t("DesktopMain.assistants.failed", { clients: list(failed) });
  if (done.length === 0) {
    await finish({ type: "warning", message: failure }, [], true);
    return;
  }
  await finish(
    {
      type: failed.length > 0 ? "warning" : "info",
      message: t("DesktopMain.assistants.done", { clients: list(done) }),
    },
    [t("DesktopMain.assistants.restart"), ...(failed.length > 0 ? [failure] : [])],
    failed.length > 0,
  );
}

/** Help → Check for Updates…: always reports what it found. */
function checkForUpdatesNow() {
  return withUpdateDialog(async () => {
    const t = tr();
    if (downloading) {
      await dialog.showMessageBox({
        type: "info",
        message: t("DesktopMain.updates.downloading", { version: downloading.version }),
        buttons: [t("DesktopMain.updates.ok")],
      });
      return;
    }
    let release: Release | null;
    try {
      release = await checkForRelease();
    } catch {
      await dialog.showMessageBox({
        type: "warning",
        message: t("DesktopMain.updates.failed"),
        detail: t("DesktopMain.updates.failedDetail"),
        buttons: [t("DesktopMain.updates.ok")],
      });
      return;
    }
    if (release) await offerRelease(release);
    else {
      await dialog.showMessageBox({
        type: "info",
        message: t("DesktopMain.updates.upToDate"),
        detail: t("DesktopMain.updates.upToDateDetail", { version: app.getVersion() }),
        buttons: [t("DesktopMain.updates.ok")],
      });
    }
  });
}

/**
 * Offers to download and install the release, or on macOS to open its release page, where
 * the user downloads and installs it themselves.
 */
async function offerRelease(release: Release) {
  const t = tr();
  const install = installsUpdates();
  const current = app.getVersion();
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: t("DesktopMain.updates.available", { version: release.version }),
    detail: install
      ? t("DesktopMain.updates.installDetail", { current })
      : t("DesktopMain.updates.availableDetail", { current }),
    buttons: [
      install ? t("DesktopMain.updates.downloadAndInstall") : t("DesktopMain.updates.download"),
      t("DesktopMain.updates.skip"),
      t("DesktopMain.updates.later"),
    ],
    defaultId: 0,
    cancelId: 2,
  });
  // Not awaited: the download takes minutes, and Check for Updates… says it's under way.
  if (response === 0 && install) void downloadRelease(release);
  else if (response === 0) void shell.openExternal(release.url);
  else if (response === 1) await saveUpdatePrefs({ skippedVersion: release.version });
}

/** Downloads the update, with its progress on the window, then offers to restart into it. */
async function downloadRelease(release: Release) {
  downloading = release;
  let failure: { error: unknown } | null = null;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    failure = { error };
  }
  downloading = null;
  window?.setProgressBar(-1);
  if (failure) {
    await installFailed(release, failure.error);
    return;
  }
  const t = tr();
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: t("DesktopMain.updates.ready", { version: release.version }),
    detail: t("DesktopMain.updates.readyDetail"),
    buttons: [t("DesktopMain.updates.restart"), t("DesktopMain.updates.later")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    // Quits as the Quit command does, asking about unsaved projects; `will-quit` installs.
    installOnQuit = release;
    app.quit();
  }
}

/** Installs the downloaded update and starts the new version; if that fails, just quits. */
function installAndRestart(release: Release) {
  // Kept until the app exits: on Windows a failure to start the installer comes after
  // `quitAndInstall` has returned, and without a listener it would be an unhandled rejection.
  autoUpdater.once("error", async (error) => {
    // Otherwise the quit would try again, asking for a password a second time on Linux.
    autoUpdater.autoInstallOnAppQuit = false;
    await installFailed(release, error);
    app.quit();
  });
  // The new version may start before this one exits (an AppImage does at once): it mustn't
  // find the lock taken and quit.
  app.releaseSingleInstanceLock();
  // Silent, then runs the new version; electron-updater quits on success.
  autoUpdater.quitAndInstall(true, true);
}

/** Says the update couldn't be installed and offers its release page instead. */
async function installFailed(release: Release, error: unknown) {
  const t = tr();
  const detail = t("DesktopMain.updates.installFailedDetail", { version: release.version });
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: t("DesktopMain.updates.installFailed"),
    detail: error instanceof Error ? `${detail}\n\n${error.message}` : detail,
    buttons: [t("DesktopMain.updates.download"), t("DesktopMain.updates.ok")],
    defaultId: 0,
    cancelId: 1,
  });
  // Awaited: after a failed restart the app quits next.
  if (response === 0) await shell.openExternal(release.url);
}

function createWindow() {
  closeAllowed = false;
  modified = false;
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: "Furrow CAM",
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const current = window;
  current.once("ready-to-show", () => current.show());
  current.on("close", (event) => {
    if (!modified || closeAllowed) return;
    event.preventDefault();
    // If the user cancels, a later close mustn't quit.
    quitAfterClose = quitting;
    quitting = false;
    installAfterClose = installOnQuit;
    installOnQuit = null;
    current.webContents.send(CHANNELS.closeRequest);
  });
  current.on("closed", () => {
    if (window === current) window = null;
  });

  // Links out of the app (docs, the website) open in the system browser.
  current.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  current.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(DEV_URL ?? APP_ORIGIN)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  void current.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

function send(command: MenuCommand) {
  return () => window?.webContents.send(CHANNELS.menu, command);
}

/**
 * The application menu, in the current language. Role items get labels too:
 * Electron's own are English only.
 */
function buildMenu() {
  const t = tr();
  const name = app.name;
  const mac = process.platform === "darwin";
  const quit = { role: "quit" as const, label: t("DesktopMain.menu.quit", { app: name }) };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: name,
            submenu: [
              { role: "about" as const, label: t("DesktopMain.menu.about", { app: name }) },
              { type: "separator" as const },
              { role: "services" as const, label: t("DesktopMain.menu.services") },
              { type: "separator" as const },
              { role: "hide" as const, label: t("DesktopMain.menu.hide", { app: name }) },
              { role: "hideOthers" as const, label: t("DesktopMain.menu.hideOthers") },
              { role: "unhide" as const, label: t("DesktopMain.menu.showAll") },
              { type: "separator" as const },
              quit,
            ],
          },
        ]
      : []),
    {
      label: t("DesktopMain.menu.file"),
      submenu: [
        { label: t("DesktopMain.menu.newProject"), accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: t("DesktopMain.menu.open"), accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        { label: t("DesktopMain.menu.save"), accelerator: "CmdOrCtrl+S", click: send("save") },
        {
          label: t("DesktopMain.menu.saveAs"),
          accelerator: "Shift+CmdOrCtrl+S",
          click: send("save-as"),
        },
        { type: "separator" },
        {
          label: t("DesktopMain.menu.closeProject"),
          accelerator: "CmdOrCtrl+W",
          click: send("close"),
        },
        ...(mac ? [] : [{ type: "separator" as const }, quit]),
      ],
    },
    {
      // No undo or redo roles: their shortcuts would never reach the workspace's own undo.
      label: t("DesktopMain.menu.edit"),
      submenu: [
        { role: "cut", label: t("DesktopMain.menu.cut") },
        { role: "copy", label: t("DesktopMain.menu.copy") },
        { role: "paste", label: t("DesktopMain.menu.paste") },
        { role: "selectAll", label: t("DesktopMain.menu.selectAll") },
      ],
    },
    {
      label: t("DesktopMain.menu.view"),
      submenu: [
        ...(DEV_URL
          ? [
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "resetZoom", label: t("DesktopMain.menu.actualSize") },
        { role: "zoomIn", label: t("DesktopMain.menu.zoomIn") },
        { role: "zoomOut", label: t("DesktopMain.menu.zoomOut") },
        { type: "separator" },
        { role: "togglefullscreen", label: t("DesktopMain.menu.fullScreen") },
      ],
    },
    {
      // `window` makes it macOS's Window menu, which adds its own window list.
      role: mac ? "window" : undefined,
      label: t("DesktopMain.menu.window"),
      submenu: [
        { role: "minimize", label: t("DesktopMain.menu.minimize") },
        ...(mac
          ? [
              { role: "zoom" as const, label: t("DesktopMain.menu.zoom") },
              { type: "separator" as const },
              { role: "front" as const, label: t("DesktopMain.menu.front") },
            ]
          : [{ role: "close" as const, label: t("DesktopMain.menu.closeWindow") }]),
      ],
    },
    {
      role: "help",
      label: t("DesktopMain.menu.help"),
      submenu: [
        { label: t("DesktopMain.menu.checkUpdates"), click: () => void checkForUpdatesNow() },
        {
          label: t("DesktopMain.menu.reportBug"),
          click: () =>
            void shell.openExternal(
              blankReportUrl([
                ["App", `desktop ${app.getVersion()}`],
                ["System", `${process.platform} ${osRelease()} (${process.arch})`],
              ]),
            ),
        },
        { label: t("DesktopMain.menu.setUpAssistants"), click: () => void setUpAssistants() },
        { label: t("DesktopMain.menu.licences"), click: send("licences") },
        { type: "separator" },
        {
          label: t("DesktopMain.menu.checkAtStartup"),
          type: "checkbox",
          checked: updatePrefs.checkAtStartup === true,
          click: (item) => void saveUpdatePrefs({ checkAtStartup: item.checked }),
        },
        ...(POSTHOG_KEY
          ? [
              {
                label: t("DesktopMain.menu.sendUsage"),
                type: "checkbox" as const,
                checked: telemetryPrefs.enabled === true,
                click: (item: { checked: boolean }) =>
                  void saveTelemetryPrefs({ enabled: item.checked }),
              },
            ]
          : []),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

async function readProject(path: string) {
  try {
    // Taken before reading, so a change while reading shows at the next save.
    const stamp = await fileStamp(path);
    const bytes = new Uint8Array(await readFile(path));
    await addRecent(path);
    return { path, name: projectName(path), bytes, stamp };
  } catch {
    return { error: tr()("DesktopMain.files.openFailed", { name: projectName(path) }) };
  }
}

/**
 * Whether to save over `path`, which the open project last read or wrote as
 * `stamp` (#491): `path` if it is still that, or deleted (nothing to lose),
 * or the user chose to replace it; `null` to save elsewhere; `undefined` to
 * cancel. Asks again if it changes while the question is open.
 */
async function confirmReplace(path: string, stamp: FileStamp): Promise<string | null | undefined> {
  const t = tr();
  let seen = stamp;
  for (;;) {
    const now = await fileStamp(path);
    if (now === seen || now === null) return path;
    // E.g. an assistant saved it through the MCP server.
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: t("DesktopMain.files.changed", { name: projectName(path) }),
      detail: t("DesktopMain.files.changedDetail"),
      buttons: [
        t("DesktopMain.files.replace"),
        t("DesktopMain.files.saveAs"),
        t("DesktopMain.files.cancel"),
      ],
      defaultId: 1,
      cancelId: 2,
    });
    if (response === 2) return undefined;
    if (response === 1) return null;
    // Replaces what the user was warned about, not a later save.
    seen = now;
  }
}

async function addRecent(path: string) {
  const recent = withRecent(parseRecent(await readJson(recentPath())), path);
  await writeJson(recentPath(), recent);
  app.addRecentDocument(path);
}

function registerIpc() {
  ipcMain.handle(CHANNELS.openFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: tr()("DesktopMain.files.projects"), extensions: [...OPEN_EXTENSIONS] }],
    });
    const [path] = result.filePaths;
    return result.canceled || path === undefined ? null : readProject(path);
  });

  ipcMain.handle(CHANNELS.readFile, (_event, path: unknown) =>
    typeof path === "string" ? readProject(path) : { error: tr()("DesktopMain.files.noFile") },
  );

  ipcMain.handle(
    CHANNELS.saveFile,
    async (_event, path: unknown, suggestedName: unknown, bytes: unknown, stamp: unknown) => {
      const t = tr();
      if (!(bytes instanceof Uint8Array)) return { error: t("DesktopMain.files.nothingToSave") };
      let target = typeof path === "string" ? path : null;
      if (target !== null && (typeof stamp === "string" || stamp === null)) {
        const confirmed = await confirmReplace(target, stamp);
        if (confirmed === undefined) return null;
        target = confirmed;
      }
      if (target === null) {
        const folder = typeof path === "string" ? dirname(path) : app.getPath("documents");
        const result = await dialog.showSaveDialog({
          defaultPath: join(folder, `${String(suggestedName)}.furrow`),
          filters: [{ name: t("DesktopMain.files.project"), extensions: ["furrow"] }],
        });
        if (result.canceled || !result.filePath) return null;
        target = result.filePath.endsWith(".furrow")
          ? result.filePath
          : `${result.filePath}.furrow`;
      }
      let saved: FileStamp;
      try {
        await writeFileAtomic(target, bytes);
        saved = await fileStamp(target);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { error: t("DesktopMain.files.saveFailed", { reason }) };
      }
      await addRecent(target);
      return { path: target, name: projectName(target), stamp: saved };
    },
  );

  ipcMain.handle(CHANNELS.recentFiles, async () => {
    const recent = parseRecent(await readJson(recentPath()));
    return existingRecent(recent);
  });

  ipcMain.handle(CHANNELS.readData, (_event, file: unknown) =>
    isDataFile(file) ? readJson(join(dataDir(), `${file}.json`)) : null,
  );
  ipcMain.handle(CHANNELS.writeData, async (_event, file: unknown, data: unknown) => {
    if (isDataFile(file)) await writeJson(join(dataDir(), `${file}.json`), data);
  });

  ipcMain.handle(
    CHANNELS.writeRecovery,
    (_event, recovery: Omit<Recovery, "savedAt">, bytes: unknown) => {
      if (bytes instanceof Uint8Array) return recoveries().write(recovery, bytes);
    },
  );
  ipcMain.handle(CHANNELS.deleteRecovery, (_event, id: string) => recoveries().delete(id));
  ipcMain.handle(CHANNELS.listRecoveries, () => recoveries().list());
  ipcMain.handle(CHANNELS.readRecovery, (_event, id: string) => recoveries().read(id));

  ipcMain.handle(CHANNELS.askUnsaved, async (_event, name: unknown): Promise<UnsavedChoice> => {
    const t = tr();
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: t("DesktopMain.files.askSave", { name: String(name) }),
      detail: t("DesktopMain.files.askSaveDetail"),
      buttons: [
        t("DesktopMain.files.save"),
        t("DesktopMain.files.dontSave"),
        t("DesktopMain.files.cancel"),
      ],
      defaultId: 0,
      cancelId: 2,
    });
    return response === 0 ? "save" : response === 1 ? "discard" : "cancel";
  });

  ipcMain.on(
    CHANNELS.setWindowState,
    (_event, state: { title: string; path: string | null; modified: boolean }) => {
      if (!window) return;
      modified = state.modified;
      const mac = process.platform === "darwin";
      window.setTitle(!mac && state.modified ? `• ${state.title}` : state.title);
      if (mac) {
        window.setDocumentEdited(state.modified);
        window.setRepresentedFilename(state.path ?? "");
      }
    },
  );

  ipcMain.on(CHANNELS.closeWindow, () => {
    closeAllowed = true;
    if (quitAfterClose) {
      installOnQuit = installAfterClose;
      app.quit();
    } else window?.close();
  });

  ipcMain.on(CHANNELS.trackEvent, (_event, data: unknown) => {
    const event = parseTelemetryEvent(data);
    if (event) track(event);
  });
  ipcMain.on(CHANNELS.reportError, (_event, error: unknown) => captureError(error));

  ipcMain.handle(CHANNELS.getLocale, () => currentLocale());
  ipcMain.handle(CHANNELS.setLocale, async (_event, locale: unknown) => {
    if (!isLocale(locale)) return;
    pickedLocale = locale;
    Menu.setApplicationMenu(buildMenu());
    await writeJson(localePath(), { picked: locale }).catch((error: unknown) =>
      warnUnsaved("language", error),
    );
  });

  ipcMain.handle(CHANNELS.takePendingPaths, () => {
    const paths = pendingPaths;
    pendingPaths = [];
    return paths;
  });
}

/** Translates in the current language; a new one each time, so a change of language applies at once. */
function tr() {
  return translator(currentLocale());
}

/** The interface language: the picked one, else the first supported system language, else English. */
function currentLocale(): Locale {
  return pickedLocale ?? matchLocale([...app.getPreferredSystemLanguages(), app.getLocale()]);
}

function isDataFile(file: unknown): file is DataFile {
  return DATA_FILES.includes(file as DataFile);
}
