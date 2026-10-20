import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import { SimulatorShell } from "@furrow/workspace/components/simulator-shell";
import { WorkspaceShell } from "@furrow/workspace/components/workspace-shell";
import { messageOf, saveTool } from "@furrow/workspace/lib/local-library";
import type {
  WorkspaceDestination,
  WorkspaceHost,
  WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import { useAutosaveApi } from "@furrow/workspace/providers/workspace-stores";
import type * as React from "react";
import { createContext, type RefObject, useContext, useEffect, useMemo, useRef } from "react";
import packageJson from "../../../package.json";
import type { LibraryState } from "./app";
import type { ProjectSession } from "./session";

/** What the window shows: navigation is view state, not routes (ADR-0045). */
export type Page =
  | { name: "start" }
  | { name: "workspace" }
  | { name: "simulator" }
  | { name: "tools" }
  | { name: "machines" }
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
  children,
}: {
  session: ProjectSession;
  page: Page;
  library: LibraryState;
  updateLibrary: (change: (state: LibraryState) => LibraryState) => Promise<void>;
  navigate: (page: Page) => void;
  flush: RefObject<() => Promise<unknown>>;
  children: React.ReactNode;
}) {
  /** The library as last rendered, for saves that finish after another render. */
  const latest = useRef(library);
  latest.current = library;
  const { tools, machines } = library;
  const { workspaceTourDone } = library.settings;
  /** The panel sizes the user last chose, before they reach the disk. */
  const layout = useRef(library.settings.workspaceLayout);

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
      versions: session.host.versions,
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
      limits: { meshes: DEFAULT_STL_LIMITS },
    }),
    // `name` changes on Save As; the stores are keyed by `id`, so they stay.
    [session, session.name, tools, machines, workspaceTourDone, updateLibrary],
  );

  const onWorkspace = page.name === "workspace" || page.name === "simulator";
  return (
    <NavigateContext value={navigate}>
      <div className="relative flex h-dvh flex-col overflow-hidden">
        <ProjectShell host={host}>
          <AutosaveFlush flush={flush} />
          {page.name === "simulator" ? (
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
