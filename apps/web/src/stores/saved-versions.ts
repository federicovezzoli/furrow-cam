import type { ProjectDocument } from "@furrow/document";

export type SavedVersion = { document: ProjectDocument; updatedAt: Date };

/**
 * The last version of each project saved from this tab. On back/forward the
 * router can restore a workspace from its cached server payload, which
 * predates later autosaves; opening that would show old contents and make the
 * next save fail as a conflict.
 */
const savedVersions = new Map<string, SavedVersion>();

export function rememberSavedVersion(projectId: string, version: SavedVersion) {
  savedVersions.set(projectId, version);
}

/** `rendered`, or the version saved from this tab since, whichever is newer. */
export function latestVersion(projectId: string, rendered: SavedVersion): SavedVersion {
  const saved = savedVersions.get(projectId);
  return saved && saved.updatedAt > rendered.updatedAt ? saved : rendered;
}
