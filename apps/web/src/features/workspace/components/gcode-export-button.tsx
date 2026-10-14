"use client";

import type { ProjectDocument } from "@furrow/document";
import { FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { GcodeRequest, GcodeResponse } from "@/features/workspace/workers/gcode.worker";
import { downloadFile } from "@/lib/download";

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The program is computed in a Web Worker started for the
 * export (ADR-0004), from the document as it is on screen. Disabled while
 * `disabledReason` says why.
 */
export function GcodeExportButton({
  name,
  getDocument,
  disabledReason,
}: {
  name: string;
  getDocument: () => ProjectDocument;
  disabledReason?: string;
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

  const button = (
    <Button
      variant="ghost"
      size="compact"
      onClick={onClick}
      disabled={pending || disabledReason !== undefined}
      title={disabledReason === undefined ? "Export G-code" : undefined}
    >
      <FileCodeIcon />
      G-code
    </Button>
  );
  if (disabledReason === undefined) return button;
  // A disabled button gets no pointer events, so its wrapper shows why.
  return (
    <span title={disabledReason} className="inline-flex">
      {button}
    </span>
  );
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
