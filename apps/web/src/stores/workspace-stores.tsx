"use client";

import type { ProjectDocument } from "@furrow/document";
import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import { saveProject } from "@/app/(app)/projects/actions";
import { type Autosave, createAutosave } from "./autosave";
import { createDocumentStore, type DocumentState, type DocumentStore } from "./document-store";
import { latestVersion, rememberSavedVersion } from "./saved-versions";
import { createToolpathStore, type ToolpathState, type ToolpathStore } from "./toolpath-store";
import { createWorkspaceStore, type WorkspaceState, type WorkspaceStore } from "./workspace-store";

/** Quiet time after the last change before the document is saved. */
export const AUTOSAVE_DELAY = 1000;

type Stores = {
  document: DocumentStore;
  workspace: WorkspaceStore;
  toolpaths: ToolpathStore;
  autosave: Autosave;
};

const StoresContext = createContext<Stores | null>(null);

/**
 * Creates the stores of one open project (ADR-0010) and its autosave, which
 * the workspace starts. They live as long as this provider rather than in
 * module scope, so server renders never share them; key it by project id so
 * another project starts fresh.
 */
export function WorkspaceStoresProvider({
  project,
  children,
}: {
  /** As rendered by the server. */
  project: { id: string; document: ProjectDocument; updatedAt: Date };
  children: React.ReactNode;
}) {
  const [stores] = useState<Stores>(() => {
    const { document, updatedAt } = latestVersion(project.id, project);
    const documentStore = createDocumentStore(document);
    return {
      document: documentStore,
      workspace: createWorkspaceStore(),
      toolpaths: createToolpathStore(),
      autosave: createAutosave(documentStore, {
        savedAt: updatedAt,
        delay: AUTOSAVE_DELAY,
        async save(document, savedAt) {
          const result = await saveProject(project.id, document, savedAt);
          if (result.error === undefined) {
            rememberSavedVersion(project.id, { document, updatedAt: result.updatedAt });
          }
          return result;
        },
      }),
    };
  });
  return <StoresContext value={stores}>{children}</StoresContext>;
}

function useStores() {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("Workspace stores used outside WorkspaceStoresProvider");
  return stores;
}

/** Reads the document store through a narrow selector; re-renders when the selected value changes. */
export function useDocumentStore<T>(selector: (state: DocumentState) => T): T {
  return useStore(useStores().document, selector);
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useStores().workspace, selector);
}

export function useToolpathStore<T>(selector: (state: ToolpathState) => T): T {
  return useStore(useStores().toolpaths, selector);
}

/**
 * The stores themselves, for `getState()` and `subscribe()` in per-frame or
 * pointer-move code that must not re-render (ADR-0010).
 */
export function useDocumentStoreApi() {
  return useStores().document;
}

export function useWorkspaceStoreApi() {
  return useStores().workspace;
}

export function useToolpathStoreApi() {
  return useStores().toolpaths;
}

/** The open project's autosave; `useAutosave` starts it. */
export function useAutosaveApi() {
  return useStores().autosave;
}
