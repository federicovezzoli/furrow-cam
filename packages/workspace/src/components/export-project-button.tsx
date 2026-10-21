"use client";

import type { ProjectDocument } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { errorText } from "@furrow/ui/lib/i18n";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { EXPORT_FAILED, exportProjectFile } from "../lib/export-project";
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
  const { project, meshes } = useWorkspaceHost();
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  function onClick() {
    const document = getDocument();
    startTransition(async () => {
      try {
        await exportProjectFile(document, project.name, meshes.get);
      } catch (error) {
        // A mesh that couldn't be read says why.
        const text = error instanceof Error ? error.message : EXPORT_FAILED;
        window.alert(errorText(t, error, text));
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
      title="Export file"
    >
      <DownloadIcon />
      Export project file
    </Button>
  );
}
