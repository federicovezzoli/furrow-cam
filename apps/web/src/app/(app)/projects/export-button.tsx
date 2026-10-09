"use client";

import { projectFileName } from "@furrow/document";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { loadProject } from "./actions";

/** Downloads the project `id` as a `.furrow.json` file, upgraded to the current schema version. */
export function ExportButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await loadProject(id);
      if (result.error !== undefined) {
        window.alert(result.error);
        return;
      }
      const { project } = result;
      const blob = new Blob([`${JSON.stringify(project.document, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = projectFileName(project.name);
      link.click();
      // Revoking right away can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url));
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={`Export ${name}`}
      title="Export file"
    >
      <DownloadIcon />
    </Button>
  );
}
