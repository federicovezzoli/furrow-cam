"use client";

import type { ProjectDocument } from "@furrow/document";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { useRef } from "react";
import type { Layout, LayoutChangedMeta } from "react-resizable-panels";
import { FormError } from "@/components/auth/form-error";
import { ExportButton } from "@/components/projects/export-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useAutosave } from "@/hooks/use-autosave";
import { useUndoShortcuts } from "@/hooks/use-undo-shortcuts";
import { saveWorkspaceLayout, type WorkspaceLayout } from "@/lib/workspace-layout";
import type { AutosaveStatus } from "@/stores/autosave";
import { useDocumentStore, WorkspaceStoresProvider } from "@/stores/workspace-stores";
import { SaveStatus } from "./save-status";

type ProjectRow = { id: string; name: string; updatedAt: Date };

type WorkspaceProject = ProjectRow &
  ({ document: ProjectDocument; error?: never } | { document?: never; error: string });

/**
 * The CAM workspace (ADR-0009): a top bar over three resizable columns,
 * geometry and operations on the left, the viewport in the centre and
 * properties on the right. Panel contents land with their own issues.
 * Panel sizes are remembered in a cookie (`layout` is what it held).
 */
export function WorkspaceShell({
  project,
  layout,
}: {
  project: WorkspaceProject;
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
    <WorkspaceStoresProvider key={project.id} document={project.document}>
      <Workspace project={project} layout={layout} />
    </WorkspaceStoresProvider>
  );
}

/** The workspace of a project that opened; its document lives in the stores (ADR-0010). */
function Workspace({ project, layout }: { project: ProjectRow; layout: WorkspaceLayout }) {
  const saveStatus = useAutosave(project.id, project.updatedAt);
  useUndoShortcuts();
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
      <TopBar project={project} saveStatus={saveStatus} />
      {/* Below the panels' minimum widths (180 + 200 + 200px), scroll sideways instead of clipping them. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-148"
          defaultLayout={layout.columns}
          onLayoutChanged={remember("columns")}
        >
          <ResizablePanel
            id="sidebar"
            defaultSize={260}
            minSize={180}
            maxSize="40%"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
          >
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={layout.sidebar}
              onLayoutChanged={remember("sidebar")}
            >
              <ResizablePanel id="geometry" minSize={80}>
                <Pane title="Geometry">
                  <EmptyState>Import an SVG or DXF file to add geometry.</EmptyState>
                </Pane>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="operations" minSize={80}>
                <Pane title="Operations">
                  <EmptyState>No operations yet.</EmptyState>
                </Pane>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="viewport" minSize={200}>
            <section
              aria-label="Viewport"
              className="flex h-full items-center justify-center bg-muted/40"
            >
              <EmptyState>Viewport</EmptyState>
            </section>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="properties"
            defaultSize={280}
            minSize={200}
            maxSize="40%"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
          >
            <Pane title="Properties">
              <StockProperties />
            </Pane>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}

/** `saveStatus` is left out when the project couldn't be opened. */
function TopBar({ project, saveStatus }: { project: ProjectRow; saveStatus?: AutosaveStatus }) {
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
      {saveStatus && <SaveStatus status={saveStatus} />}
      <div className="ml-auto flex items-center gap-1">
        {saveStatus && <ExportButton id={project.id} name={project.name} size="compact" />}
        <ThemeToggle size="icon-compact" />
      </div>
    </header>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex h-full flex-col">
      <h2 className="flex h-control shrink-0 items-center border-b px-3 text-ui-label font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-ui text-muted-foreground">{children}</p>;
}

const mmFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

/** Read-only stock summary shown while nothing is selected; editing comes with #17. */
function StockProperties() {
  const stock = useDocumentStore((s) => s.document.stock);
  const rows = [
    ["Width", stock.width],
    ["Height", stock.height],
    ["Thickness", stock.thickness],
  ] as const;
  return (
    <div className="p-3 text-ui">
      <h3 className="mb-2 font-medium">Stock</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right tabular-nums">{mmFormat.format(value)} mm</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
