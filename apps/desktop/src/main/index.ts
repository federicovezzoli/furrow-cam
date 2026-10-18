import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
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
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    window?.once("ready-to-show", () => void startupUpdateCheck());
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
 * The only exception is the update check's own session, which reaches the
 * releases list and nothing else (ADR-0048).
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

async function saveUpdatePrefs(change: UpdatePrefs) {
  updatePrefs = { ...updatePrefs, ...change };
  await writeJson(updatesPath(), updatePrefs);
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
    release = newerRelease(app.getVersion(), await fetchLatestRelease());
  } catch {
    // Offline, or GitHub is unavailable: the next start tries again.
    return;
  }
  if (release && release.version !== updatePrefs.skippedVersion) await offerRelease(release);
}

/** Help → Check for Updates…: always reports what it found. */
async function checkForUpdatesNow() {
  let release: Release | null;
  try {
    release = newerRelease(app.getVersion(), await fetchLatestRelease());
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
          label: "Check for Updates at Start-up",
          type: "checkbox",
          checked: updatePrefs.checkAtStartup === true,
          click: (item) => void saveUpdatePrefs({ checkAtStartup: item.checked }),
        },
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

  ipcMain.handle(CHANNELS.takePendingPaths, () => {
    const paths = pendingPaths;
    pendingPaths = [];
    return paths;
  });
}

function isDataFile(file: unknown): file is DataFile {
  return DATA_FILES.includes(file as DataFile);
}
