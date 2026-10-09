"use client";

import type { ProjectDocument } from "@furrow/document";
import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import { createDocumentStore, type DocumentState, type DocumentStore } from "./document-store";
import { createToolpathStore, type ToolpathState, type ToolpathStore } from "./toolpath-store";
import { createWorkspaceStore, type WorkspaceState, type WorkspaceStore } from "./workspace-store";

type Stores = { document: DocumentStore; workspace: WorkspaceStore; toolpaths: ToolpathStore };

const StoresContext = createContext<Stores | null>(null);

/**
 * Creates the stores of one open project (ADR-0010). They live as long as this
 * provider rather than in module scope, so server renders never share them;
 * key it by project id so another project starts fresh.
 */
export function WorkspaceStoresProvider({
  document,
  children,
}: {
  document: ProjectDocument;
  children: React.ReactNode;
}) {
  const [stores] = useState<Stores>(() => ({
    document: createDocumentStore(document),
    workspace: createWorkspaceStore(),
    toolpaths: createToolpathStore(),
  }));
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
