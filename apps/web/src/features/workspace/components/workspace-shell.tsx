"use client";

import { ChevronDownIcon, ChevronLeftIcon, CircleAlertIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type * as React from "react";
import { useRef, useState } from "react";
import { type Layout, type LayoutChangedMeta, usePanelRef } from "react-resizable-panels";
import { FormError } from "@/components/form-error";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { MachineChoice } from "@/features/machines/server";
import { ExportButton } from "@/features/projects/components/export-button";
import type { getProject, ProjectRow } from "@/features/projects/server";
import type { ToolChoice } from "@/features/tools/server";
import { useAutosave } from "@/features/workspace/hooks/use-autosave";
import { useToolpaths } from "@/features/workspace/hooks/use-toolpaths";
import { useUndoShortcuts } from "@/features/workspace/hooks/use-undo-shortcuts";
import {
  savedLayout,
  saveWorkspaceLayout,
  type WorkspaceLayout,
} from "@/features/workspace/lib/workspace-layout";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  WorkspaceStoresProvider,
} from "@/features/workspace/providers/workspace-stores";
import type { AutosaveStatus } from "@/features/workspace/stores/autosave";
import { cn } from "@/lib/utils";
import { GcodeExportButton } from "./gcode-export-button";
import { GeometryImport } from "./geometry-import";
import { OperationProperties } from "./operation-properties";
import { OperationsPane } from "./operations-pane";
import { SaveStatus } from "./save-status";
import { StockProperties } from "./stock-properties";
import { ToolLibraryProvider } from "./tool-library";

/** WebGL needs the browser (ADR-0008), so the viewport never renders on the server. */
const Viewport = dynamic(
  () => import("@/features/workspace/components/viewport/viewport").then((m) => m.Viewport),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <EmptyState>Loading viewport…</EmptyState>
      </div>
    ),
  },
);

type WorkspaceProject = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/**
 * The CAM workspace (ADR-0009): a top bar over two resizable columns,
 * operations over properties on the left and the viewport on the right.
 * Panes collapse to their headers; panel sizes are remembered in a cookie
 * (`layout` is what it held).
 * `tools` is the user's tool library, offered for operations, and
 * `machines` their machine profiles, offered for the project.
 */
export function WorkspaceShell({
  project,
  tools,
  machines,
  layout,
}: {
  project: WorkspaceProject;
  tools: ToolChoice[];
  machines: MachineChoice[];
  layout: WorkspaceLayout;
}) {
  if (project.error !== undefined) {
    return (
      <>
        <TopBar project={project} />
        {/* Retrying can't fix a document this release can't read, so don't fall into error.tsx. */}
        <main className="mx-auto w-full max-w-2xl p-8">
          <FormError message={project.error} />
        </main>
      </>
    );
  }
  return (
    <WorkspaceStoresProvider key={project.id} project={project}>
      <ToolLibraryProvider tools={tools}>
        <Workspace project={project} machines={machines} layout={layout} />
      </ToolLibraryProvider>
    </WorkspaceStoresProvider>
  );
}

/** The workspace of a project that opened; its document lives in the stores (ADR-0010). */
function Workspace({
  project,
  machines,
  layout,
}: {
  project: ProjectRow;
  machines: MachineChoice[];
  layout: WorkspaceLayout;
}) {
  const saveStatus = useAutosave();
  const machineName = useDocumentStore((s) => s.document.machine?.name ?? null);
  const hasEnabledOperations = useDocumentStore((s) =>
    s.document.operations.some((operation) => operation.enabled),
  );
  useUndoShortcuts();
  useToolpaths();
  const documentStore = useDocumentStoreApi();
  const getDocument = () => documentStore.getState().document;
  const operationsPanel = usePanelRef();
  const propertiesPanel = usePanelRef();
  const saved = useRef(layout);

  function remember(group: keyof WorkspaceLayout) {
    return (sizes: Layout, meta: LayoutChangedMeta) => {
      // Window resizes and the initial mount aren't a choice worth keeping.
      if (!meta.isUserInteraction) return;
      saved.current = { ...saved.current, [group]: sizes };
      saveWorkspaceLayout(saved.current);
    };
  }

  return (
    <>
      <TopBar project={project} saveStatus={saveStatus} machineName={machineName} />
      {saveStatus.state === "failed" && <SaveFailed message={saveStatus.error} />}
      {/* Below the panels' minimum widths (200 + 200px), scroll sideways instead of clipping them. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-100"
          defaultLayout={savedLayout(layout.columns, ["sidebar", "viewport"])}
          onLayoutChanged={remember("columns")}
        >
          <ResizablePanel
            id="sidebar"
            defaultSize={300}
            minSize={200}
            maxSize="50%"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
          >
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={savedLayout(layout.sidebar, ["operations", "properties"])}
              onLayoutChanged={remember("sidebar")}
            >
              <Pane
                id="operations"
                title="Operations"
                panel={operationsPanel}
                sibling={propertiesPanel}
                defaultSize="40"
                footer={
                  <GcodeExportButton
                    name={project.name}
                    getDocument={getDocument}
                    disabledReason={
                      machineName === null
                        ? "Choose a machine in the project properties first"
                        : !hasEnabledOperations
                          ? "Add or enable an operation first"
                          : undefined
                    }
                    className="w-full"
                  />
                }
              >
                <OperationsPane />
              </Pane>
              <ResizableHandle />
              <Pane
                id="properties"
                title="Properties"
                panel={propertiesPanel}
                sibling={operationsPanel}
                defaultSize="60"
                footer={
                  <ExportButton
                    id={project.id}
                    name={project.name}
                    getDocument={getDocument}
                    size="compact"
                    className="w-full"
                  />
                }
              >
                <Properties machines={machines} />
              </Pane>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="viewport" minSize={200}>
            <section aria-label="Viewport" className="relative h-full bg-muted/40">
              <Viewport />
              <GeometryImport />
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}

/** The selected operation's properties, or the project's while none is selected. */
function Properties({ machines }: { machines: MachineChoice[] }) {
  const selectedId = useWorkspaceStore((s) => s.selectedOperationId);
  // Keyed, so nothing typed or rejected for one operation shows on the next.
  if (selectedId !== null) return <OperationProperties key={selectedId} operationId={selectedId} />;
  return <StockProperties machines={machines} />;
}

/**
 * `saveStatus` and `machineName` are left out when the project couldn't be
 * opened. `machineName` is `null` for a project without a machine.
 */
function TopBar({
  project,
  saveStatus,
  machineName,
}: {
  project: ProjectRow;
  saveStatus?: AutosaveStatus;
  machineName?: string | null;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Button variant="ghost" size="icon-compact" asChild>
        <Link href="/projects" aria-label="All projects" title="All projects">
          <ChevronLeftIcon />
        </Link>
      </Button>
      <h1 className="min-w-0 truncate text-sm font-semibold" title={project.name}>
        {project.name}
      </h1>
      {machineName !== undefined && (
        <span
          className="min-w-0 truncate text-ui text-muted-foreground"
          title={machineName ?? undefined}
        >
          {machineName ?? "No machine set"}
        </span>
      )}
      {saveStatus && <SaveStatus status={saveStatus} />}
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle size="icon-compact" />
      </div>
    </header>
  );
}

/** Autosave stopped for good (e.g. a conflict): say so where it can't be missed. */
function SaveFailed({ message }: { message: string | undefined }) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-ui text-destructive"
    >
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {message} Changes are no longer saved; export the project to keep them.
      </p>
      <Button variant="outline" size="compact" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}

type PanelRef = ReturnType<typeof usePanelRef>;

/** The height of a pane's header (`h-control`), all that a collapsed pane shows. */
const PANE_HEADER = "1.75rem";

/**
 * A sidebar pane: dragging its edge resizes it, and its header collapses it to
 * just the header or expands it. Collapsing it expands its `sibling` if that
 * is collapsed: one of the two always shows. `footer` stays at its bottom while
 * the rest scrolls.
 */
function Pane({
  id,
  title,
  panel,
  sibling,
  defaultSize,
  footer,
  children,
}: {
  id: string;
  title: string;
  panel: PanelRef;
  sibling: PanelRef;
  defaultSize: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function toggle() {
    if (collapsed) {
      panel.current?.expand();
      return;
    }
    if (sibling.current?.isCollapsed()) sibling.current.expand();
    panel.current?.collapse();
  }

  return (
    <ResizablePanel
      id={id}
      panelRef={panel}
      defaultSize={defaultSize}
      minSize={96}
      collapsible
      collapsedSize={PANE_HEADER}
      onResize={() => setCollapsed(panel.current?.isCollapsed() ?? false)}
    >
      <section aria-label={title} className="flex h-full flex-col">
        <h2 className="h-control shrink-0 border-b text-ui-label font-medium tracking-wide text-muted-foreground uppercase">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={toggle}
            className="flex size-full items-center gap-1 px-2 uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
            />
            {title}
          </button>
        </h2>
        {!collapsed && (
          <>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
            {footer && <div className="shrink-0 border-t p-2">{footer}</div>}
          </>
        )}
      </section>
    </ResizablePanel>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-ui text-muted-foreground">{children}</p>;
}
