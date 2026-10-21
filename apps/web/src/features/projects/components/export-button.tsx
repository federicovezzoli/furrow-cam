"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { errorText } from "@furrow/ui/lib/i18n";
import { exportProjectFile } from "@furrow/workspace/lib/export-project";
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
  const projects = useTranslations("Projects");
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  function onClick() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loadProject>>;
      try {
        result = await loadProject(id);
      } catch {
        window.alert(t("Shell.exportFailed"));
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
        const text = error instanceof Error ? error.message : t("Shell.exportFailed");
        window.alert(errorText(t, error, text));
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={projects("exportLabel", { name })}
      title={projects("exportFile")}
    >
      <DownloadIcon />
    </Button>
  );
}
