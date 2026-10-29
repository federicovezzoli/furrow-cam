import { createProjectDocument, type Machine } from "@furrow/document";
import { useDialogs } from "@furrow/ui/components/dialogs";
import { errorText } from "@furrow/ui/lib/i18n";
import {
  parseMachines,
  parseSettings,
  parseTools,
  type Settings,
} from "@furrow/workspace/lib/local-library";
import { type ProjectFile, readProjectFile } from "@furrow/workspace/lib/project-file";
import { track } from "@furrow/workspace/lib/telemetry";
import type { MachineChoice, ToolChoice } from "@furrow/workspace/lib/workspace-host";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Recovery } from "../../shared/api";
import { api } from "./api";
import { AppFrame } from "./app-frame";
import { type Page, ProjectView } from "./desktop-host";
import { t } from "./i18n";
import { LibraryPage } from "./library-pages";

import { createProjectSession, type ProjectSession } from "./session";
import { StartScreen } from "./start-screen";

/** The library and settings, once read from the data folder. */
export type LibraryState = {
  tools: ToolChoice[];
  machines: MachineChoice[];
  settings: Settings;
};

/**
 * The desktop app (PRD-0007): the start screen, or one open project in the
 * shared workspace, plus the library pages. Owns the open session and the
 * New, Open, Save, Save As and Close commands from the menu.
 */
export function App() {
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [session, setSession] = useState<ProjectSession | null>(null);
  /** Bumped when the session's name, path or unsaved state changes, to render it again. */
  const [, setRevision] = useState(0);
  const [page, setPage] = useState<Page>({ name: "start" });
  const [newProject, setNewProject] = useState(false);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { alert } = useDialogs();
  /** Settles the open workspace's autosave, so the session has the document on screen. */
  const flush = useRef<() => Promise<unknown>>(async () => {});
  /** The session as last rendered, for commands that outlive a render (menus, dialogs). */
  const current = useRef(session);
  current.current = session;

  useEffect(() => {
    void Promise.all([
      api.readData("tools"),
      api.readData("machines"),
      api.readData("settings"),
    ]).then(([tools, machines, settings]) => {
      const loaded = {
        tools: parseTools(tools),
        machines: parseMachines(machines),
        settings: parseSettings(settings),
      };
      // The first start seeds the default bit; store it, so its id stays the same.
      if (tools === null) void api.writeData("tools", loaded.tools);
      stored.current = loaded;
      setLibrary(loaded);
    });
    void api.listRecoveries().then(setRecoveries);
  }, []);

  /** The library as last stored, for changes that build on the one before. */
  const stored = useRef(library);

  /** The library change being stored, which the next one waits for. */
  const storing = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Applies `change` to the library and stores it, showing it once it's on
   * disk. Changes are stored one at a time, each building on the one before
   * (resizing the workspace's panes saves the layout often). Rejects with an
   * `Error` for the user if it couldn't be stored, and the library stays as it was.
   */
  const updateLibrary = useCallback((change: (state: LibraryState) => LibraryState) => {
    const update = storing.current.then(async () => {
      const before = stored.current;
      if (!before) return;
      const next = change(before);
      try {
        if (next.tools !== before.tools) await api.writeData("tools", next.tools);
        if (next.machines !== before.machines) await api.writeData("machines", next.machines);
        if (next.settings !== before.settings) await api.writeData("settings", next.settings);
      } catch (error) {
        console.error(error);
        throw new Error(t("Desktop.App.libraryNotSaved"));
      }
      stored.current = next;
      setLibrary(next);
    });
    storing.current = update.catch(() => {});
    return update;
  }, []);

  function open(
    file: ProjectFile,
    options: { path: string | null; name: string; id?: string; modified?: boolean },
  ) {
    let created: ProjectSession;
    const recovery = () => ({ id: created.id, path: created.path, name: created.name });
    created = createProjectSession({
      ...options,
      file,
      onChange: () => setRevision((n) => n + 1),
      writeRecovery: (bytes) => api.writeRecovery(recovery(), bytes),
      deleteRecovery: () => api.deleteRecovery(created.id),
      openAsProject: (copy, name) =>
        void replaceWith(() => open(copy, { path: null, name, modified: true })),
    });
    current.current = created;
    setSession(created);
    setPage({ name: "workspace" });
    setError(null);
  }

  /**
   * Saves the open project to its file, or where the user picks when it has
   * none or `as` is set. Resolves with whether it was saved.
   */
  async function save(as = false): Promise<boolean> {
    const session = current.current;
    if (!session) return false;
    await flush.current();
    let prepared: ReturnType<ProjectSession["prepareSave"]>;
    try {
      prepared = session.prepareSave();
    } catch (error) {
      void alert(errorText(t, error, t("Desktop.App.projectNotSaved")));
      return false;
    }
    const result = await api.saveFile(as ? null : session.path, session.name, prepared.bytes);
    if (result === null) return false;
    if ("error" in result) {
      void alert(result.error);
      return false;
    }
    // Edits made while the file was written stay unsaved.
    session.markSaved(result.path, result.name, prepared.contents);
    return true;
  }

  /** Whether the open project may be closed: saved, its changes discarded, or none open. */
  async function closeOpen(): Promise<boolean> {
    const session = current.current;
    if (!session) return true;
    await flush.current();
    if (session.modified) {
      const choice = await api.askUnsaved(session.name);
      if (choice === "cancel") return false;
      if (choice === "save" && !(await save())) return false;
    }
    const discarded = session.discard();
    current.current = null;
    setSession(null);
    void discarded.then(() => api.listRecoveries()).then(setRecoveries);
    return true;
  }

  /** Closes the open project, then runs `next` (e.g. opening another). */
  async function replaceWith(next: () => void) {
    if (await closeOpen()) next();
  }

  /** Shows why something failed: on the start screen, or in a dialog over an open project. */
  function report(message: string) {
    if (current.current) void alert(message);
    else setError(message);
  }

  async function openBytes(bytes: Uint8Array, path: string, name: string) {
    let file: ProjectFile;
    try {
      file = await readProjectFile(bytes, t);
    } catch (error) {
      const reason = error instanceof Error ? error.message : t("Desktop.App.unreadable");
      report(t("Desktop.App.openFailed", { name, reason }));
      return;
    }
    // Only `.furrow` files are saved over; others are saved as a new `.furrow` file.
    const savable = /\.furrow$/i.test(path);
    await replaceWith(() => open(file, { path: savable ? path : null, name }));
  }

  async function openDialog() {
    const result = await api.openFile();
    if (result === null) return;
    if ("error" in result) report(result.error);
    else await openBytes(result.bytes, result.path, result.name);
  }

  async function openPath(path: string) {
    const result = await api.readFile(path);
    if ("error" in result) report(result.error);
    else await openBytes(result.bytes, result.path, result.name);
  }

  async function restore(recovery: Recovery) {
    const bytes = await api.readRecovery(recovery.id);
    if (!bytes) {
      setError(t("Desktop.App.recoveryUnreadable"));
      return;
    }
    try {
      const file = await readProjectFile(bytes, t);
      open(file, { path: recovery.path, name: recovery.name, id: recovery.id, modified: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Desktop.App.recoveryUnreadable"));
    }
  }

  async function discardRecovery(recovery: Recovery) {
    await api.deleteRecovery(recovery.id);
    setRecoveries((list) => list.filter((r) => r.id !== recovery.id));
  }

  function createProject(machine: Machine) {
    setNewProject(false);
    track({ event: "project_created" });
    open(
      {
        document: { ...createProjectDocument(), machine },
        meshes: new Map(),
        fonts: new Map(),
        versions: [],
      },
      { path: null, name: t("Desktop.App.untitled") },
    );
  }

  const onMenu = useEffectEvent((command: string) => {
    switch (command) {
      case "new":
        void replaceWith(() => {
          setPage({ name: "start" });
          setNewProject(true);
        });
        break;
      case "open":
        void openDialog();
        break;
      case "save":
        void save();
        break;
      case "save-as":
        void save(true);
        break;
      case "close":
        if (current.current) void replaceWith(() => setPage({ name: "start" }));
        else api.closeWindow();
        break;
    }
  });
  const onOpenPath = useEffectEvent((path: string) => void openPath(path));
  const onCloseRequest = useEffectEvent(() => {
    void closeOpen().then((closed) => closed && api.closeWindow());
  });

  useEffect(() => {
    const unsubscribe = [
      api.onMenu((command) => onMenu(command)),
      api.onOpenPath((path) => onOpenPath(path)),
      api.onCloseRequest(() => onCloseRequest()),
    ];
    void api.takePendingPaths().then((paths) => {
      const [first] = paths;
      if (first !== undefined) onOpenPath(first);
    });
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, []);

  useEffect(() => {
    api.setWindowState({
      title: session ? `${session.name} — Furrow CAM` : "Furrow CAM",
      path: session?.path ?? null,
      modified: session?.modified ?? false,
    });
  });

  if (!library) {
    return <p className="m-auto p-8 text-sm text-muted-foreground">{t("Desktop.App.loading")}</p>;
  }

  /** Goes to `next`; leaving the project for the start screen closes it first. */
  function navigate(next: Page) {
    if (next.name === "start" && session) void replaceWith(() => setPage(next));
    else setPage(next);
  }

  const libraryPage =
    page.name === "tools" || page.name === "machines" || page.name === "machine" ? (
      <AppFrame page={page} navigate={navigate}>
        <LibraryPage
          page={page}
          library={library}
          updateLibrary={updateLibrary}
          navigate={navigate}
          back={session ? { name: "workspace" } : { name: "start" }}
        />
      </AppFrame>
    ) : null;

  if (session) {
    return (
      <ProjectView
        session={session}
        page={page}
        library={library}
        updateLibrary={updateLibrary}
        navigate={navigate}
        flush={flush}
      >
        {libraryPage}
      </ProjectView>
    );
  }

  return (
    libraryPage ?? (
      <AppFrame page={page} navigate={navigate}>
        <StartScreen
          machines={library.machines}
          recoveries={recoveries}
          error={error}
          newProject={newProject}
          onNewProject={setNewProject}
          onCreate={createProject}
          onOpen={() => void openDialog()}
          onOpenPath={(path) => void openPath(path)}
          onRestore={(recovery) => void restore(recovery)}
          onDiscardRecovery={(recovery) => void discardRecovery(recovery)}
          navigate={navigate}
        />
      </AppFrame>
    )
  );
}
