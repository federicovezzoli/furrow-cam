import {
  type LonLat,
  modelRect,
  type StlLimits,
  type TerrainSettings,
  translatePoint,
} from "@furrow/cam-core";
import { type Message, type Point, pointsCoincide, type Shape } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentStore } from "../stores/document-store";
import { addImportedShapes, canImportModel, ONE_MODEL } from "../stores/geometry-actions";
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
 * The terrain's outline (in the mesh's mm, its lowest corner at the origin)
 * as a closed shape at `origin`, where the model's lowest corner is, named
 * after the place; `null` with fewer than three distinct points.
 */
export function outlineShape(outline: readonly Point[], origin: Point, name: string): Shape | null {
  const points: Point[] = [];
  for (const point of outline) {
    const placed = translatePoint(point, origin);
    const last = points.at(-1);
    if (!last || !pointsCoincide(last, placed)) points.push(placed);
  }
  const first = points[0];
  if (first && points.length > 1 && pointsCoincide(first, points.at(-1) as Point)) points.pop();
  if (!first || points.length < 3) return null;
  return {
    id: crypto.randomUUID(),
    name,
    layer: "",
    source: name,
    drawingId: crypto.randomUUID(),
    paths: [
      {
        start: first,
        segments: points.slice(1).map((to) => ({ kind: "line" as const, to })),
        closed: true,
      },
    ],
  };
}

/**
 * Adds a generated terrain to the open project as its model, named
 * `<name>.stl`, at the size it was made and centred on the stock (PRD-0014
 * T5), with its outline as a drawing around it in the same undo step (T7),
 * for a profile cut. Returns why it couldn't, or `null`.
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
    alongside: (id) => {
      const model = host.document.getState().document.models.find((m) => m.id === id);
      const outline = model && outlineShape(terrain.outline, modelRect(model).min, name);
      if (outline)
        addImportedShapes(host.document, "addTerrainOutline", [outline], { inPlace: true });
    },
  });
  if (!error) track({ event: "file_imported", format: "terrain" });
  return error;
}
