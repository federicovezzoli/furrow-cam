"use client";

import type * as React from "react";
import { useAutosave } from "@/features/workspace/hooks/use-autosave";
import { useToolpaths } from "@/features/workspace/hooks/use-toolpaths";
import type { WorkspaceHost } from "@/features/workspace/lib/workspace-host";
import { WorkspaceHostProvider } from "@/features/workspace/providers/workspace-host";
import { WorkspaceStoresProvider } from "@/features/workspace/providers/workspace-stores";
import { ToolLibraryProvider } from "./tool-library";

/**
 * The project `host` opens (ADR-0045), around every page of it (ADR-0042):
 * its stores (ADR-0010), the user's tool library, autosave and the
 * toolpaths, computed in a Web Worker (ADR-0004). Rendered around the
 * project's pages, so they live while the user moves between them, and the
 * document, its undo history and the toolpaths already computed survive the
 * navigation.
 */
export function ProjectShell({
  host,
  children,
}: {
  host: WorkspaceHost;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceHostProvider host={host}>
      <WorkspaceStoresProvider key={host.project.id}>
        <ToolLibraryProvider tools={host.library.tools}>
          <ProjectServices />
          {children}
        </ToolLibraryProvider>
      </WorkspaceStoresProvider>
    </WorkspaceHostProvider>
  );
}

/** What keeps running on every page of the open project. */
function ProjectServices() {
  useAutosave();
  useToolpaths();
  return null;
}
