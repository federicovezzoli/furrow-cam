"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { EXPORT_FAILED, exportProjectFile } from "@furrow/workspace/lib/export-project";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { loadMesh } from "@/features/assets/lib/mesh-cache";
import { loadProject } from "@/features/projects/actions";

/**
 * Downloads the project `id` as a `.furrow.json` file, upgraded to the current schema version,
 * or as a `.furrow.zip` file with its meshes when it has 3D models (ADR-0029). The workspace
 * exports its open document with its own button instead.
 */
export function ExportButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("Projects");
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loadProject>>;
      try {
        result = await loadProject(id);
      } catch {
        window.alert(EXPORT_FAILED);
        return;
      }
      if (result.error !== undefined) {
        window.alert(result.error);
        return;
      }
      const { document, name: projectName } = result.project;
      try {
        await exportProjectFile(document, projectName, (sha256) => loadMesh(id, sha256));
      } catch (error) {
        // A mesh that couldn't be downloaded says why.
        window.alert(error instanceof Error ? error.message : EXPORT_FAILED);
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={t("exportLabel", { name })}
      title={t("exportFile")}
    >
      <DownloadIcon />
    </Button>
  );
}
