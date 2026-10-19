import type { StlLimits } from "@furrow/cam-core";
import { projectFileName } from "@furrow/document";
import { importGuestDocument } from "@/features/projects/actions";
import { importArchive } from "@/features/projects/lib/archive-import";
import { deleteGuestProject, getGuestMesh, getGuestProject } from "./storage";

/** A guest project that couldn't be imported, and why; it stays in the browser. */
export type FailedImport = { id: string; name: string; error: string };

/** Which guest projects became which account projects, and which failed. */
export type ImportToAccountResult = {
  imported: { id: string; projectId: string }[];
  failed: FailedImport[];
};

const IMPORT_FAILED = "It couldn't be imported. Check your connection and try again.";

/**
 * Imports the guest projects `ids` into the signed-in account, one at a time
 * (PRD-0008 G7), through the same checks as importing a file: a project's
 * document, or with 3D models its archive with the STL files, which the
 * account must be able to store (`meshLimits`, `null` when it can't). Each
 * project leaves the browser only once its import succeeded.
 */
export async function importToAccount(
  ids: string[],
  meshLimits: StlLimits | null,
): Promise<ImportToAccountResult> {
  const result: ImportToAccountResult = { imported: [], failed: [] };
  for (const id of ids) {
    let name = "A project";
    try {
      const project = await getGuestProject(id);
      if (!project) continue;
      name = project.name;
      const fileName = projectFileName(project.name);
      const contents = JSON.stringify(project.document);
      let imported: { projectId: string; error?: never } | { error: string };
      if (project.document.models.length === 0) {
        imported = await importGuestDocument(
          new File([contents], fileName, { type: "application/json" }),
          fileName,
        );
      } else if (!meshLimits) {
        imported = { error: "It has 3D models, which this server can't store." };
      } else {
        const meshes = new Map<string, Uint8Array>();
        for (const { sha256 } of project.document.models) {
          if (!meshes.has(sha256))
            meshes.set(sha256, new Uint8Array(await getGuestMesh(id, sha256)));
        }
        imported = await importArchive(
          { contents, meshes, versions: [] },
          fileName,
          null,
          meshLimits,
        );
      }
      if (imported.error !== undefined) {
        result.failed.push({ id, name, error: imported.error });
        continue;
      }
      result.imported.push({ id, projectId: imported.projectId });
      // Imported: a failure to delete leaves a copy to import or discard later.
      await deleteGuestProject(id).catch(() => {});
    } catch (error) {
      result.failed.push({
        id,
        name,
        error: error instanceof Error && error.message ? error.message : IMPORT_FAILED,
      });
    }
  }
  return result;
}
