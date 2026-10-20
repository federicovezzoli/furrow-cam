import { readFile } from "node:fs/promises";
import { release as osRelease } from "node:os";
import { extname, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
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
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { PostHog } from "posthog-node";
import {
  CHANNELS,
  type DataFile,
  type MenuCommand,
  OPEN_EXTENSIONS,
  type Recovery,
  type UnsavedChoice,
} from "../shared/api";
import {
  existingRecent,
  parseRecent,
  projectName,
  projectPathsIn,
  readJson,
  recoveryStore,
  withRecent,
  writeFileAtomic,
  writeJson,
} from "./files";
import { parseTelemetryPrefs, type TelemetryPrefs } from "./telemetry";
import {
  latestDesktopRelease,
  newerRelease,
  parseUpdatePrefs,
  RELEASES_URL,
  type Release,
  type UpdatePrefs,
} from "./updates";

/** In development the renderer comes from electron-vite's dev server. */
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
/** The built renderer, next to `package.json` (or inside the app's archive). */
const rendererDir = () => join(app.getAppPath(), "out/renderer");
const APP_ORIGIN = "app://furrow";

/**
 * The renderer only loads its own files: no connections leave the app
 * (ADR-0044, PRD-0007 D2). Workers and the viewport's textures use blobs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
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
/** Files to open that arrived before the renderer asked for them. */
let pendingPaths: string[] = projectPathsIn(process.argv.slice(1));
let updatePrefs: UpdatePrefs = {};
/** Writes of `updates.json`, in order, so the last choice is also the one on disk. */
let prefsWrite = Promise.resolve();
/** The request in flight, shared by the start-up check and the menu. */
let releaseCheck: Promise<Release | null> | null = null;
/** An update dialog is open: another would repeat it. */
let updateDialogOpen = false;
let telemetryPrefs: TelemetryPrefs = {};
/** Writes of `telemetry.json`, in order, as `prefsWrite`. */
let telemetryWrite = Promise.resolve();
/** Running only while the user agrees. */
let posthog: PostHog | null = null;

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
  // Sends what's queued, for at most two seconds, before the app quits.
  app.on("will-quit", (event) => {
    const client = posthog;
    if (!client) return;
    posthog = null;
    event.preventDefault();
    void client.shutdown(2_000).finally(() => app.quit());
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
    applyTelemetry();
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
 * releases list and nothing else (ADR-0048), and telemetry's, which reaches
 * only PostHog (ADR-0052).
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
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: "Send anonymous usage statistics and error reports?",
    detail:
      'They help fix crashes and show which features are used: events such as "G-code exported" and error messages, never your files, projects or anything that identifies you. You can change this in the Help menu.',
    buttons: ["Send", "Don't Send"],
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
    .catch((error: unknown) => warnUnsaved("Your choice about usage statistics", error));
  return telemetryWrite;
}

/** Says that a choice couldn't be saved and only lasts until the app quits. */
async function warnUnsaved(what: string, error: unknown) {
  const reason = error instanceof Error ? ` (${error.message})` : "";
  await dialog.showMessageBox({
    type: "warning",
    message: `${what} couldn't be saved`,
    detail: `It applies until Furrow CAM quits${reason}.`,
    buttons: ["OK"],
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

/** A newer release than the running app, or `null`; throws when GitHub can't be reached. */
function checkForRelease() {
  releaseCheck ??= fetchLatestRelease()
    .then((latest) => newerRelease(app.getVersion(), latest))
    .finally(() => {
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
    .catch((error: unknown) => warnUnsaved("Your update choice", error));
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
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: "Check for new versions when Furrow CAM starts?",
      detail:
        "Furrow CAM will ask GitHub for its list of releases. Nothing about you or your projects is sent. You can change this in the Help menu.",
      buttons: ["Check at Start-up", "Don't Check"],
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

/** Help → Check for Updates…: always reports what it found. */
function checkForUpdatesNow() {
  return withUpdateDialog(async () => {
    let release: Release | null;
    try {
      release = await checkForRelease();
    } catch {
      await dialog.showMessageBox({
        type: "warning",
        message: "Couldn't check for updates",
        detail: "Furrow CAM couldn't reach GitHub. Check your connection and try again.",
        buttons: ["OK"],
      });
      return;
    }
    if (release) await offerRelease(release);
    else {
      await dialog.showMessageBox({
        type: "info",
        message: "Furrow CAM is up to date",
        detail: `Version ${app.getVersion()} is the newest.`,
        buttons: ["OK"],
      });
    }
  });
}

/** Offers to open the release page; the user downloads and installs it themselves. */
async function offerRelease(release: Release) {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Furrow CAM ${release.version} is available`,
    detail: `You have ${app.getVersion()}. Download the new version from its release page and install it over this one.`,
    buttons: ["Download", "Skip This Version", "Later"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) void shell.openExternal(release.url);
  else if (response === 1) await saveUpdatePrefs({ skippedVersion: release.version });
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

function buildMenu() {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
        { label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", click: send("save-as") },
        { type: "separator" },
        { label: "Close Project", accelerator: "CmdOrCtrl+W", click: send("close") },
        ...(mac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      // No undo or redo roles: their shortcuts would never reach the workspace's own undo.
      label: "Edit",
      submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "View",
      submenu: [
        ...(DEV_URL
          ? [
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for Updates…", click: () => void checkForUpdatesNow() },
        {
          label: "Report a Bug…",
          click: () =>
            void shell.openExternal(
              blankReportUrl([
                ["App", `desktop ${app.getVersion()}`],
                ["System", `${process.platform} ${osRelease()} (${process.arch})`],
              ]),
            ),
        },
        { type: "separator" },
        {
          label: "Check for Updates at Start-up",
          type: "checkbox",
          checked: updatePrefs.checkAtStartup === true,
          click: (item) => void saveUpdatePrefs({ checkAtStartup: item.checked }),
        },
        ...(POSTHOG_KEY
          ? [
              {
                label: "Send Usage Statistics and Error Reports",
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
    const bytes = new Uint8Array(await readFile(path));
    await addRecent(path);
    return { path, name: projectName(path), bytes };
  } catch {
    return { error: `${projectName(path)} couldn't be opened. It may have been moved or deleted.` };
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
      filters: [{ name: "Furrow CAM projects", extensions: [...OPEN_EXTENSIONS] }],
    });
    const [path] = result.filePaths;
    return result.canceled || path === undefined ? null : readProject(path);
  });

  ipcMain.handle(CHANNELS.readFile, (_event, path: unknown) =>
    typeof path === "string" ? readProject(path) : { error: "No file to open." },
  );

  ipcMain.handle(
    CHANNELS.saveFile,
    async (_event, path: unknown, suggestedName: unknown, bytes: unknown) => {
      if (!(bytes instanceof Uint8Array)) return { error: "Nothing to save." };
      let target = typeof path === "string" ? path : null;
      if (target === null) {
        const result = await dialog.showSaveDialog({
          defaultPath: join(app.getPath("documents"), `${String(suggestedName)}.furrow`),
          filters: [{ name: "Furrow CAM project", extensions: ["furrow"] }],
        });
        if (result.canceled || !result.filePath) return null;
        target = result.filePath.endsWith(".furrow")
          ? result.filePath
          : `${result.filePath}.furrow`;
      }
      try {
        await writeFileAtomic(target, bytes);
      } catch (error) {
        const reason = error instanceof Error ? ` (${error.message})` : "";
        return { error: `The project couldn't be saved${reason}.` };
      }
      await addRecent(target);
      return { path: target, name: projectName(target) };
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
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: `Save the changes to ${String(name)}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ["Save", "Don't Save", "Cancel"],
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
    if (quitAfterClose) app.quit();
    else window?.close();
  });

  ipcMain.on(CHANNELS.trackEvent, (_event, data: unknown) => {
    const event = parseTelemetryEvent(data);
    if (event) track(event);
  });
  ipcMain.on(CHANNELS.reportError, (_event, error: unknown) => captureError(error));

  ipcMain.handle(CHANNELS.takePendingPaths, () => {
    const paths = pendingPaths;
    pendingPaths = [];
    return paths;
  });
}

function isDataFile(file: unknown): file is DataFile {
  return DATA_FILES.includes(file as DataFile);
}
