import { createElement } from "react";
import type { VersionRow, WorkspaceHost } from "./workspace-host";

/** A version kept by `createMemoryHost`, with its document. */
type StoredVersion = VersionRow & { document: WorkspaceHost["project"]["document"] };

const CONFLICT = "The project was changed elsewhere.";

/**
 * A workspace host that keeps everything in memory (ADR-0045), for tests and
 * previews: saves check `savedAt` as the server does, meshes and versions
 * are kept in maps, and links go nowhere. `project` and `library` start the
 * host; `overrides` replace any of its parts.
 */
export function createMemoryHost(
  project: Pick<WorkspaceHost["project"], "document"> & Partial<WorkspaceHost["project"]>,
  overrides: Partial<Omit<WorkspaceHost, "project">> = {},
): WorkspaceHost & {
  /** What the host has stored, to check in tests. */
  stored: {
    document: () => WorkspaceHost["project"]["document"];
    meshes: Map<string, ArrayBuffer>;
    versions: () => StoredVersion[];
  };
} {
  let document = project.document;
  let savedAt = project.savedAt ?? new Date(0);
  const meshes = new Map<string, ArrayBuffer>();
  let versions: StoredVersion[] = [];
  let nextId = 1;

  /** A save time after the last, even within the same millisecond. */
  function tick() {
    savedAt = new Date(Math.max(Date.now(), savedAt.getTime() + 1));
    return savedAt;
  }
  const rows = () => versions.map(({ document: _, ...row }) => row);

  return {
    project: {
      id: "memory",
      name: "Untitled",
      savedAt,
      save: async (next, at) => {
        if (at.getTime() !== savedAt.getTime()) return { error: CONFLICT };
        document = next;
        return { updatedAt: tick() };
      },
      ...project,
    },
    meshes: {
      put: async (sha256, file) => {
        if (meshes.has(sha256)) return { uploaded: false };
        meshes.set(sha256, await file.arrayBuffer());
        return { uploaded: true };
      },
      get: async (sha256) => {
        const bytes = meshes.get(sha256);
        if (!bytes) throw new Error("This model is missing.");
        return bytes;
      },
      discard: async (sha256) => {
        meshes.delete(sha256);
      },
    },
    versions: {
      list: async () => ({ versions: rows() }),
      create: async (label, at) => {
        if (at.getTime() !== savedAt.getTime()) return { error: CONFLICT };
        const id = String(nextId++);
        versions = [
          { id, label: label.trim() || null, createdAt: new Date(), document },
          ...versions,
        ];
        return { versions: rows() };
      },
      rename: async (id, label) => {
        versions = versions.map((v) => (v.id === id ? { ...v, label: label.trim() || null } : v));
        return undefined;
      },
      delete: async (id) => {
        versions = versions.filter((v) => v.id !== id);
        return undefined;
      },
      restore: async (id, at) => {
        const version = versions.find((v) => v.id === id);
        if (!version) return { error: "This version no longer exists." };
        if (at.getTime() !== savedAt.getTime()) return { error: CONFLICT };
        const kept = { id: String(nextId++), label: null, createdAt: new Date(), document };
        versions = [kept, ...versions];
        document = version.document;
        return { document, updatedAt: tick(), versions: rows() };
      },
      openAsProject: async () => ({ error: "Not available here." }),
    },
    library: {
      tools: [],
      machines: [],
      saveTool: async () => ({ errors: { form: "Not available here." } }),
    },
    settings: { account: "memory", tourDone: true, finishTour: async () => {} },
    navigation: { Link: ({ to: _, ...props }) => createElement("a", props) },
    limits: { meshes: null },
    ...overrides,
    stored: { document: () => document, meshes, versions: () => versions },
  };
}
