"use client";

import type { ProjectDocument } from "@furrow/document";
import { FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/download";
import type { GcodeRequest, GcodeResponse } from "@/workers/gcode.worker";

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The program is computed in a Web Worker started for the
 * export (ADR-0004), from the document as it is on screen.
 */
export function GcodeExportButton({
  name,
  getDocument,
}: {
  name: string;
  getDocument: () => ProjectDocument;
}) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    let response: GcodeResponse;
    try {
      response = await postGcode({ document: getDocument(), name });
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

  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={onClick}
      disabled={pending}
      title="Export G-code"
    >
      <FileCodeIcon />
      G-code
    </Button>
  );
}

/** Runs one export in its own worker, which ends with it. */
function postGcode(request: GcodeRequest): Promise<GcodeResponse> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../../workers/gcode.worker.ts", import.meta.url), {
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
