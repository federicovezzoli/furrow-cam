import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { MAX_FONT_BYTES } from "@furrow/document";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import { SimulatorShell } from "@furrow/workspace/components/simulator-shell";
import { WorkspaceShell } from "@furrow/workspace/components/workspace-shell";
import { messageOf, saveTool } from "@furrow/workspace/lib/local-library";
import type { ProjectFile } from "@furrow/workspace/lib/project-file";
import type {
  WorkspaceDestination,
  WorkspaceHost,
  WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import { useAutosaveApi, useDocumentStoreApi } from "@furrow/workspace/providers/workspace-stores";
import type * as React from "react";
import { createContext, type RefObject, useContext, useEffect, useMemo, useRef } from "react";
import packageJson from "../../../package.json";
import type { FileStamp } from "../../shared/api";
import type { LibraryState } from "./app";
import type { ProjectSession } from "./session";

/**
 * Loads a project file another program saved into the open workspace (#492);
 * if there are unsaved changes, only once `confirm` resolves `true`.
 */
export type Reload = (
  file: ProjectFile,
  stamp: FileStamp,
  confirm: () => Promise<boolean>,
) => Promise<void>;

/** What the window shows: navigation is view state, not routes (ADR-0045). */
export type Page =
  | { name: "start" }
  | { name: "workspace" }
  | { name: "simulator" }
  | { name: "tools" }
  | { name: "machines" }
  /** Opened from the Help menu over any page; `back` returns to it. */
  | { name: "licences"; back: Page }
  /** A machine's form; `id` is `null` for a new one. */
  | { name: "machine"; id: string | null };

const PAGES: Record<WorkspaceDestination, Page> = {
  projects: { name: "start" },
  tools: { name: "tools" },
  "new-machine": { name: "machine", id: null },
  workspace: { name: "workspace" },
  simulator: { name: "simulator" },
};

const NavigateContext = createContext<(page: Page) => void>(() => {});

/** The workspace's links, as buttons that change the page. */
function DesktopLink({ to, onClick, ...props }: WorkspaceLinkProps) {
  const navigate = useContext(NavigateContext);
  return (
    <a
      href={`#${to}`}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        navigate(PAGES[to]);
      }}
    />
  );
}

/**
 * The open project in the shared workspace, with a host backed by `session`
 * and the library on this computer (ADR-0045). The workspace stays mounted
 * on the library pages (`children`), so the undo history survives a visit.
 * `flush` is set to settle the workspace's autosave before a save.
 */
export function ProjectView({
  session,
  page,
  library,
  updateLibrary,
  navigate,
  flush,
  reload,
  children,
}: {
  session: ProjectSession;
  page: Page;
  library: LibraryState;
  updateLibrary: (change: (state: LibraryState) => LibraryState) => Promise<void>;
  navigate: (page: Page) => void;
  flush: RefObject<() => Promise<unknown>>;
  /** Set to load a file another program saved into the open workspace. */
  reload: RefObject<Reload | null>;
  children: React.ReactNode;
}) {
  /** The library as last rendered, for saves that finish after another render. */
  const latest = useRef(library);
  latest.current = library;
  const { tools, machines } = library;
  const { workspaceTourDone } = library.settings;
  /** The panel sizes the user last chose, before they reach the disk. */
  const layout = useRef(library.settings.workspaceLayout);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `session.reloads` rebuilds the host on purpose.
  const host = useMemo<WorkspaceHost>(
    () => ({
      app: { name: "desktop", version: packageJson.version },
      project: {
        id: session.id,
        name: session.name,
        document: session.document,
        savedAt: session.savedAt,
        autosaves: false,
        save: session.host.save,
      },
      meshes: session.host.meshes,
      fonts: session.host.fonts,
      // A new object on each reload, so an open Versions pane lists the file's versions again.
      versions: session.host.versions && { ...session.host.versions },
      library: {
        tools,
        machines,
        saveTool: async (id, form) => {
          const result = saveTool(latest.current.tools, id, form);
          if ("errors" in result) return result;
          try {
            await updateLibrary((state) => ({ ...state, tools: result.tools }));
          } catch (error) {
            return { errors: { form: messageOf(error) } };
          }
          return result.saved;
        },
      },
      settings: {
        account: "desktop",
        tourDone: workspaceTourDone,
        finishTour: async () => {
          await updateLibrary((state) => ({
            ...state,
            settings: { ...state.settings, workspaceTourDone: true },
          }));
        },
        // Read when the workspace opens, so a saved layout doesn't build a new host.
        get layout() {
          return layout.current;
        },
        saveLayout: (workspaceLayout) => {
          layout.current = workspaceLayout;
          updateLibrary((state) => ({
            ...state,
            settings: { ...state.settings, workspaceLayout },
          })).catch((error: unknown) => console.error(error));
        },
      },
      navigation: { Link: DesktopLink },
      limits: { meshes: DEFAULT_STL_LIMITS, fonts: { maxBytes: MAX_FONT_BYTES } },
    }),
    // `name` changes on Save As, `reloads` when another program saved the file (#492), so
    // the Versions pane lists its versions again; the stores are keyed by `id`, so they stay.
    [session, session.name, session.reloads, tools, machines, workspaceTourDone, updateLibrary],
  );

  const onWorkspace = page.name === "workspace" || page.name === "simulator";
  // The licences page opens over the simulator without ending the simulation.
  const simulating =
    page.name === "simulator" || (page.name === "licences" && page.back.name === "simulator");
  return (
    <NavigateContext value={navigate}>
      <div className="relative flex h-dvh flex-col overflow-hidden">
        <ProjectShell host={host}>
          <AutosaveFlush flush={flush} />
          <ExternalReload session={session} reload={reload} />
          {simulating ? (
            <SimulatorShell />
          ) : (
            // Hidden rather than unmounted on the library pages, keeping the viewport's state.
            <div className={onWorkspace ? "contents" : "hidden"}>
              <WorkspaceShell />
            </div>
          )}
          {!onWorkspace && (
            <div className="absolute inset-0 overflow-auto bg-background">{children}</div>
          )}
        </ProjectShell>
      </div>
    </NavigateContext>
  );
}

/** Lets the app settle the workspace's autosave, so a save writes what's on screen. */
function AutosaveFlush({ flush }: { flush: RefObject<() => Promise<unknown>> }) {
  const autosave = useAutosaveApi();
  useEffect(() => {
    flush.current = () => autosave.settle();
    return () => {
      flush.current = async () => {};
    };
  }, [autosave, flush]);
  return null;
}

/**
 * Lets the app load the project's file into the workspace after another
 * program saved it (#492), as restoring a version does: autosave holds, the
 * session takes the file, and the store starts over from its document. It
 * isn't an undo step.
 */
function ExternalReload({
  session,
  reload,
}: {
  session: ProjectSession;
  reload: RefObject<Reload | null>;
}) {
  const autosave = useAutosaveApi();
  const documentStore = useDocumentStoreApi();
  useEffect(() => {
    reload.current = async (file, stamp, confirm) => {
      // Held first: edits made until now are in the session, and count as unsaved.
      await autosave.hold();
      let savedAt: Date;
      try {
        if (session.modified && !(await confirm())) {
          autosave.release();
          return;
        }
        savedAt = session.replace(file, stamp);
      } catch (error) {
        autosave.release();
        throw error;
      }
      autosave.release({ document: file.document, savedAt });
      documentStore.getState().load(file.document);
    };
    return () => {
      reload.current = null;
    };
  }, [autosave, documentStore, session, reload]);
  return null;
}
