"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { errorText, formatMessage } from "@furrow/ui/lib/i18n";
import { exportProjectFile } from "@furrow/workspace/lib/export-project";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { loadAsset } from "@/features/assets/lib/asset-cache";
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
  const { alert } = useDialogs();

  function onClick() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loadProject>>;
      try {
        result = await loadProject(id);
      } catch {
        void alert(t("Shell.exportFailed"));
        return;
      }
      if (result.error !== undefined) {
        void alert(formatMessage(t, result.error));
        return;
      }
      const { document, name: projectName } = result.project;
      try {
        await exportProjectFile(document, projectName, (sha256) => loadAsset(id, sha256));
      } catch (error) {
        // A mesh that couldn't be downloaded says why.
        void alert(errorText(t, error, t("Shell.exportFailed")));
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
