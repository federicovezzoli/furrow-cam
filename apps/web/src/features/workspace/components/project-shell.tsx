"use client";

import type * as React from "react";
import { createContext, useContext } from "react";
import { FormError } from "@/components/form-error";
import type { MeshLimits } from "@/features/assets/server";
import type { MachineChoice } from "@/features/machines/server";
import type { getProject, ProjectRow } from "@/features/projects/server";
import type { ToolChoice } from "@/features/tools/server";
import { useAutosave } from "@/features/workspace/hooks/use-autosave";
import { useToolpaths } from "@/features/workspace/hooks/use-toolpaths";
import { WorkspaceStoresProvider } from "@/features/workspace/providers/workspace-stores";
import { ToolLibraryProvider } from "./tool-library";
import { TopBar } from "./top-bar";

type WorkspaceProject = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/** What the pages of an open project read besides its stores. */
type OpenProject = {
  project: ProjectRow;
  machines: MachineChoice[];
  userId: string;
  tourDone: boolean;
};

const OpenProjectContext = createContext<OpenProject | null>(null);

/**
 * The open project, around every page under `/projects/[id]` (ADR-0042): its
 * stores (ADR-0010), the user's tool library, autosave and the toolpaths,
 * computed in a Web Worker (ADR-0004). Rendered by the route's layout, so
 * they live while the user moves between its pages, and the document, its
 * undo history and the toolpaths already computed survive the navigation.
 * `tools` is the user's tool library, offered for operations, and
 * `machines` their machine profiles, offered for the project. `meshLimits`
 * are the STL files the server stores, `null` when STL import is off.
 * `tourDone` says the account `userId` finished the workspace tour
 * (PRD-0001 R22).
 */
export function ProjectShell({
  project,
  tools,
  machines,
  meshLimits,
  userId,
  tourDone,
  children,
}: {
  project: WorkspaceProject;
  tools: ToolChoice[];
  machines: MachineChoice[];
  meshLimits: MeshLimits | null;
  userId: string;
  tourDone: boolean;
  children: React.ReactNode;
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
  const open = {
    project: { id: project.id, name: project.name, updatedAt: project.updatedAt },
    machines,
    userId,
    tourDone,
  };
  return (
    <WorkspaceStoresProvider key={project.id} project={project} meshLimits={meshLimits}>
      <ToolLibraryProvider tools={tools}>
        <OpenProjectContext value={open}>
          <ProjectServices />
          {children}
        </OpenProjectContext>
      </ToolLibraryProvider>
    </WorkspaceStoresProvider>
  );
}

/** What keeps running on every page of the open project. */
function ProjectServices() {
  useAutosave();
  useToolpaths();
  return null;
}

export function useOpenProject(): OpenProject {
  const open = useContext(OpenProjectContext);
  if (!open) throw new Error("useOpenProject used outside ProjectShell");
  return open;
}
