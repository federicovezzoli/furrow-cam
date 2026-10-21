import type { StlLimits } from "@furrow/cam-core";
import { projectFileName } from "@furrow/document";
import { importGuestDocument } from "@/features/projects/actions";
import { importArchive } from "@/features/projects/lib/archive-import";
import { clientTranslator } from "@/lib/client-translator";
import { deleteGuestProjectIfSaved, getGuestMesh, getGuestProject } from "./storage";

/** A guest project that couldn't be imported, and why; it stays in the browser. */
export type FailedImport = { id: string; name: string; error: string };

/**
 * Which guest projects became which account projects, which failed, and
 * which were imported but stay in the browser because they changed meanwhile.
 */
export type ImportToAccountResult = {
  imported: { id: string; projectId: string }[];
  failed: FailedImport[];
  changed: { id: string; name: string }[];
};

const importFailed = () => clientTranslator()("Guest.importFailed");

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
  const result: ImportToAccountResult = { imported: [], failed: [], changed: [] };
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
          project.name,
        );
      } else if (!meshLimits) {
        imported = { error: clientTranslator()("Guest.noModelStorage") };
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
          project.name,
        );
      }
      if (imported.error !== undefined) {
        result.failed.push({ id, name, error: imported.error });
        continue;
      }
      result.imported.push({ id, projectId: imported.projectId });
      // Saved in another tab meanwhile: the account has the copy read above, and the
      // newer one stays here to import or discard. A failure to delete also leaves it.
      const deleted = await deleteGuestProjectIfSaved(id, project.savedAt).catch(() => false);
      if (!deleted) result.changed.push({ id, name });
    } catch (error) {
      result.failed.push({
        id,
        name,
        error: error instanceof Error && error.message ? error.message : importFailed(),
      });
    }
  }
  return result;
}
