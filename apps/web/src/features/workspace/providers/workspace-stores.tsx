"use client";

import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import type { WorkspaceHost } from "@/features/workspace/lib/workspace-host";
import { type Autosave, createAutosave } from "@/features/workspace/stores/autosave";
import {
  createDocumentStore,
  type DocumentState,
  type DocumentStore,
} from "@/features/workspace/stores/document-store";
import { latestVersion, rememberSavedVersion } from "@/features/workspace/stores/saved-versions";
import {
  createToolpathStore,
  type ToolpathState,
  type ToolpathStore,
} from "@/features/workspace/stores/toolpath-store";
import {
  createWorkspaceStore,
  type WorkspaceState,
  type WorkspaceStore,
} from "@/features/workspace/stores/workspace-store";
import { useWorkspaceHost } from "./workspace-host";

/** Quiet time after the last change before the document is saved. */
export const AUTOSAVE_DELAY = 1000;

export type WorkspaceStores = {
  document: DocumentStore;
  workspace: WorkspaceStore;
  toolpaths: ToolpathStore;
  autosave: Autosave;
};

const StoresContext = createContext<WorkspaceStores | null>(null);

/**
 * The stores of the project `host` opens (ADR-0010), and its autosave, which
 * saves through the host.
 */
export function createWorkspaceStores({
  project,
}: Pick<WorkspaceHost, "project">): WorkspaceStores {
  const { document, updatedAt } = latestVersion(project.id, {
    document: project.document,
    updatedAt: project.savedAt,
  });
  const documentStore = createDocumentStore(document);
  const workspaceStore = createWorkspaceStore();
  // Both live as long as the stores, so the subscription needs no cleanup.
  documentStore.subscribe((state, previous) => {
    if (state.document !== previous.document) workspaceStore.getState().prune(state.document);
  });
  return {
    document: documentStore,
    workspace: workspaceStore,
    toolpaths: createToolpathStore(),
    autosave: createAutosave(documentStore, {
      savedAt: updatedAt,
      delay: AUTOSAVE_DELAY,
      async save(document, savedAt) {
        const result = await project.save(document, savedAt);
        if (result.error === undefined) {
          rememberSavedVersion(project.id, { document, updatedAt: result.updatedAt });
        }
        return result;
      },
    }),
  };
}

/**
 * Creates the stores of the project the workspace host opens and its
 * autosave, which the workspace starts. They live as long as this provider
 * rather than in module scope, so server renders never share them; key it by
 * project id so another project starts fresh.
 */
export function WorkspaceStoresProvider({ children }: { children: React.ReactNode }) {
  const host = useWorkspaceHost();
  const [stores] = useState(() => createWorkspaceStores(host));
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
