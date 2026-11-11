import type { LonLat, StlLimits, TerrainSettings } from "@furrow/cam-core";
import type { Message } from "@furrow/document";
import type { GeneratedTerrain } from "./mesh-worker-protocol";
import { MeshImportError, runMeshWorker } from "./model-import";

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
