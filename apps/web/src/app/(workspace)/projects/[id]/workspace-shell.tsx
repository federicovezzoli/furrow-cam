"use client";

import type { ProjectDocument, Stock } from "@furrow/document";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { ExportButton } from "@/app/(app)/projects/export-button";
import { FormError } from "@/components/auth/form-error";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SaveStatus } from "./save-status";

type WorkspaceProject = { id: string; name: string; updatedAt: Date } & (
  | { document: ProjectDocument; error?: never }
  | { document?: never; error: string }
);

/**
 * The CAM workspace (ADR-0009): a top bar over three resizable columns,
 * geometry and operations on the left, the viewport in the centre and
 * properties on the right. Panel contents land with their own issues.
 */
export function WorkspaceShell({ project }: { project: WorkspaceProject }) {
  return (
    <>
      <TopBar project={project} />
      {project.error === undefined ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            id="sidebar"
            defaultSize={260}
            minSize={180}
            maxSize="40%"
            groupResizeBehavior="preserve-pixel-size"
          >
            <ResizablePanelGroup orientation="vertical">
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
          <ResizablePanel id="viewport" minSize="30%">
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
            groupResizeBehavior="preserve-pixel-size"
          >
            <Pane title="Properties">
              <StockProperties stock={project.document.stock} />
            </Pane>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        // Retrying can't fix a document this release can't read, so don't fall into error.tsx.
        <main className="mx-auto w-full max-w-2xl p-8">
          <FormError message={project.error} />
        </main>
      )}
    </>
  );
}

function TopBar({ project }: { project: WorkspaceProject }) {
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
      {project.error === undefined && <SaveStatus state="saved" savedAt={project.updatedAt} />}
      <div className="ml-auto flex items-center gap-1">
        {project.error === undefined && (
          <ExportButton id={project.id} name={project.name} size="compact" />
        )}
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

/** Read-only stock summary shown while nothing is selected; editing comes with #17. */
function StockProperties({ stock }: { stock: Stock }) {
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
            <dd className="text-right tabular-nums">{value} mm</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
