import type { LonLat, StlLimits, TerrainSettings } from "@furrow/cam-core";
import type { Message } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentStore } from "../stores/document-store";
import { canImportModel, ONE_MODEL } from "../stores/geometry-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import type { GeneratedTerrain } from "./mesh-worker-protocol";
import { MeshImportError, runMeshWorker, storeModel } from "./model-import";
import { track } from "./telemetry";
import type { WorkspaceHost } from "./workspace-host";

const UNAVAILABLE: Message = { code: "workspace.terrainUnavailable" };

/**
 * Builds the terrain of the area `ring` in a mesh worker of its own
 * (ADR-0077), which fetches the elevation and goes away with the mesh.
 * `onProgress` hears the tile requests done so far; aborting `signal` stops
 * the worker. Throws a `MeshImportError` saying why it couldn't.
 */
export async function generateTerrain(
  ring: LonLat[],
  settings: TerrainSettings,
  limits: StlLimits,
  options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<GeneratedTerrain> {
  const request = { kind: "terrain", id: 0, ring, settings, limits } as const;
  const data = await runMeshWorker(request, [], UNAVAILABLE, options);
  if (data.kind !== "terrain") throw new MeshImportError(UNAVAILABLE);
  const { kind: _, id: __, ...terrain } = data;
  return terrain;
}

/**
 * Adds a generated terrain to the open project as its model, named
 * `<name>.stl`, at the size it was made and centred on the stock (PRD-0014
 * T5). Returns why it couldn't, or `null`.
 */
export async function importTerrain(
  terrain: GeneratedTerrain,
  name: string,
  host: { meshes: WorkspaceHost["meshes"]; document: DocumentStore; workspace: WorkspaceStore },
): Promise<Translatable | null> {
  if (!canImportModel(host.document.getState().document)) return ONE_MODEL;
  const error = await storeModel(terrain, new Blob([terrain.stl]), `${name}.stl`, {
    ...host,
    fit: false,
  });
  if (!error) track({ event: "file_imported", format: "terrain" });
  return error;
}
