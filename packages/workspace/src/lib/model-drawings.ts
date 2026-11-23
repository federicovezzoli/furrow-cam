import type { Message } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";
import { addModelDrawing } from "../stores/geometry-actions";
import { gestureDone, MeshImportError, runMeshWorker } from "./model-import";
import type { WorkspaceHost } from "./workspace-host";

const FAILED: Message = { code: "workspace.modelDrawingsFailed" };

/**
 * Makes a drawing of model `modelId`'s flat levels and outline (ADR-0094),
 * found in a mesh worker of its own, and adds it as one undo step where the
 * model lies; the outline goes on the layer `outlineLayer`. Returns the new
 * drawing's id and how many levels it has, or why there is none: the model
 * has no face looking up, or its mesh couldn't be read.
 */
export async function drawingsFromModel(
  modelId: string,
  outlineLayer: string,
  { meshes, document }: { meshes: WorkspaceHost["meshes"]; document: DocumentStore },
): Promise<{ ok: true; id: string; levels: number } | { ok: false; error: Message }> {
  const model = document.getState().document.models.find(({ id }) => id === modelId);
  if (!model) return { ok: false, error: FAILED };
  try {
    const bytes = await meshes.get(model.sha256);
    const { bounds, placement, faces } = model;
    const found = await runMeshWorker(
      { kind: "faces", id: 0, bytes, model: { bounds, placement, ...(faces && { faces }) } },
      [bytes],
      FAILED,
    );
    if (found.kind !== "faces") return { ok: false, error: FAILED };
    // An undo step of its own, after any gesture still open, as `storeModel` does.
    await gestureDone(document);
    const id = addModelDrawing(document, model.fileName, found, outlineLayer);
    if (!id) return { ok: false, error: { code: "workspace.noModelFaces" } };
    return { ok: true, id, levels: found.levels.length };
  } catch (error) {
    if (!(error instanceof MeshImportError)) console.error(error);
    return { ok: false, error: error instanceof MeshImportError ? error.detail : FAILED };
  }
}
