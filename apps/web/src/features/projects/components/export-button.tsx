"use client";

import { type ProjectDocument, projectFileName } from "@furrow/document";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { loadProject } from "@/features/projects/actions";
import { downloadFile } from "@/lib/download";

/**
 * Downloads the project `id` as a `.furrow.json` file, upgraded to the current schema version.
 * `getDocument` exports the open document as it is on screen instead of the stored copy, which
 * may lack unsaved changes. `compact` is the labelled button of the workspace top bar; the
 * default is an icon.
 */
export function ExportButton({
  id,
  name,
  getDocument,
  size = "icon-sm",
}: {
  id: string;
  name: string;
  getDocument?: () => ProjectDocument;
  size?: "icon-sm" | "compact";
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (getDocument) {
      download(getDocument(), name);
      return;
    }
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loadProject>>;
      try {
        result = await loadProject(id);
      } catch {
        window.alert("This project couldn't be exported. Check your connection and try again.");
        return;
      }
      if (result.error !== undefined) {
        window.alert(result.error);
        return;
      }
      download(result.project.document, result.project.name);
    });
  }

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={onClick}
      disabled={pending}
      aria-label={`Export ${name}`}
      title="Export file"
    >
      <DownloadIcon />
      {size === "compact" && "Export"}
    </Button>
  );
}

function download(projectDocument: ProjectDocument, name: string) {
  downloadFile(
    `${JSON.stringify(projectDocument, null, 2)}\n`,
    projectFileName(name),
    "application/json",
  );
}
