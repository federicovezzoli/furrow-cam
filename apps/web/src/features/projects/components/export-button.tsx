"use client";

import {
  PROJECT_ARCHIVE_EXTENSION,
  type ProjectDocument,
  packProjectArchive,
  projectFileName,
} from "@furrow/document";
import { DownloadIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { loadProject } from "@/features/projects/actions";
import { loadMesh } from "@/features/workspace/lib/mesh-cache";
import { downloadFile } from "@/lib/download";

const EXPORT_FAILED = "This project couldn't be exported. Check your connection and try again.";

/**
 * Downloads the project `id` as a `.furrow.json` file, upgraded to the current schema version,
 * or as a `.furrow.zip` file with its meshes when it has 3D models (ADR-0029).
 * `getDocument` exports the open document as it is on screen instead of the stored copy, which
 * may lack unsaved changes. `compact` is the labelled button of the workspace's Properties
 * pane; the default is an icon.
 */
export function ExportButton({
  id,
  name,
  getDocument,
  size = "icon-sm",
  className,
}: {
  id: string;
  name: string;
  getDocument?: () => ProjectDocument;
  size?: "icon-sm" | "compact";
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    const open = getDocument?.();
    startTransition(async () => {
      let projectDocument = open;
      let projectName = name;
      if (!projectDocument) {
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
        ({ document: projectDocument, name: projectName } = result.project);
      }
      try {
        await download(id, projectDocument, projectName);
      } catch (error) {
        // A mesh that couldn't be downloaded says why.
        window.alert(error instanceof Error ? error.message : EXPORT_FAILED);
      }
    });
  }

  return (
    <Button
      variant={size === "compact" ? "outline" : "ghost"}
      size={size}
      className={className}
      onClick={onClick}
      disabled={pending}
      // The labelled button names itself; the icon is one of a list of projects.
      aria-label={size === "compact" ? undefined : `Export ${name}`}
      title="Export file"
    >
      <DownloadIcon />
      {size === "compact" && "Export project file"}
    </Button>
  );
}

async function download(id: string, projectDocument: ProjectDocument, name: string) {
  if (projectDocument.models.length === 0) {
    downloadFile(
      `${JSON.stringify(projectDocument, null, 2)}\n`,
      projectFileName(name),
      "application/json",
    );
    return;
  }
  const meshes = new Map<string, Uint8Array>();
  for (const { sha256 } of projectDocument.models) {
    if (!meshes.has(sha256)) meshes.set(sha256, new Uint8Array(await loadMesh(id, sha256)));
  }
  downloadFile(
    packProjectArchive(projectDocument, meshes),
    projectFileName(name, PROJECT_ARCHIVE_EXTENSION),
    "application/zip",
  );
}
