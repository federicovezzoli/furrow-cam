"use client";

import { operationModelId, type ProjectDocument } from "@furrow/document";
import { FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { loadMesh } from "@/features/workspace/lib/mesh-cache";
import { useProjectId } from "@/features/workspace/providers/workspace-stores";
import type { GcodeRequest, GcodeResponse } from "@/features/workspace/workers/gcode.worker";
import { downloadFile } from "@/lib/download";
import { cn } from "@/lib/utils";

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The program is computed in a Web Worker started for the
 * export (ADR-0004), from the document as it is on screen and the meshes of
 * the models its 3D operations machine. Disabled while `disabledReason` says why.
 */
export function GcodeExportButton({
  name,
  getDocument,
  disabledReason,
  className,
}: {
  name: string;
  getDocument: () => ProjectDocument;
  disabledReason?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const projectId = useProjectId();

  async function onClick() {
    setPending(true);
    let response: GcodeResponse;
    try {
      const document = getDocument();
      response = await postGcode({
        document,
        name,
        meshes: await loadMeshes(projectId, document),
      });
    } catch (error) {
      // E.g. the worker couldn't be started.
      response = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      setPending(false);
    }
    if ("error" in response) {
      window.alert(response.error);
      return;
    }
    downloadFile(response.gcode, response.fileName, "text/plain");
    if (response.warnings.length > 0) {
      window.alert(`The G-code was exported with warnings:\n\n${response.warnings.join("\n")}`);
    }
  }

  const button = (
    <Button
      size="compact"
      onClick={onClick}
      disabled={pending || disabledReason !== undefined}
      className={className}
    >
      <FileCodeIcon />
      Export G-code
    </Button>
  );
  if (disabledReason === undefined) return button;
  // A disabled button gets no pointer events, so its wrapper shows why.
  return (
    <span title={disabledReason} className={cn("inline-flex", className)}>
      {button}
    </span>
  );
}

/** The STL files of the models the enabled operations machine, by hash. */
async function loadMeshes(
  projectId: string,
  document: ProjectDocument,
): Promise<Record<string, ArrayBuffer>> {
  const modelIds = new Set(
    document.operations.flatMap((operation) =>
      operation.enabled ? (operationModelId(operation) ?? []) : [],
    ),
  );
  const hashes = new Set(
    document.models.filter((model) => modelIds.has(model.id)).map((model) => model.sha256),
  );
  const entries = await Promise.all(
    [...hashes].map(async (sha256) => [sha256, await loadMesh(projectId, sha256)] as const),
  );
  return Object.fromEntries(entries);
}

/** Runs one export in its own worker, which ends with it. */
function postGcode(request: GcodeRequest): Promise<GcodeResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../workers/gcode.worker.ts", import.meta.url), {
      type: "module",
    });
    function finish(response: GcodeResponse) {
      worker.terminate();
      resolve(response);
    }
    worker.onmessage = ({ data }: MessageEvent<GcodeResponse>) => finish(data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ error: event.message || "The G-code couldn't be computed." });
    };
    worker.onmessageerror = () => finish({ error: "The G-code couldn't be read from the worker." });
    worker.postMessage(request);
  });
}
