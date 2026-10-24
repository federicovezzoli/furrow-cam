"use client";

import type { ProjectDocument } from "@furrow/document";
import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { errorText } from "@furrow/ui/lib/i18n";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { exportProjectFile } from "../lib/export-project";
import { useWorkspaceHost } from "../providers/workspace-host";

/**
 * Downloads the open project as a `.furrow.json` file, or as a `.furrow.zip` file with its
 * meshes when it has 3D models (ADR-0029). `getDocument` gives the document as it is on
 * screen, which may have changes not saved yet.
 */
export function ExportProjectButton({
  getDocument,
  className,
}: {
  getDocument: () => ProjectDocument;
  className?: string;
}) {
  const { project, meshes, fonts } = useWorkspaceHost();
  const [pending, startTransition] = useTransition();
  const t = useTranslations();
  const { alert } = useDialogs();

  function onClick() {
    const document = getDocument();
    startTransition(async () => {
      try {
        await exportProjectFile(document, project.name, { meshes, fonts });
      } catch (error) {
        // A file that couldn't be read says why.
        void alert(errorText(t, error, t("Shell.exportFailed")));
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="compact"
      className={className}
      onClick={onClick}
      disabled={pending}
      title={t("Shell.exportFile")}
    >
      <DownloadIcon />
      {t("Shell.exportProject")}
    </Button>
  );
}
