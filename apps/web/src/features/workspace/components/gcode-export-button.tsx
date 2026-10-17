"use client";

import { FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToolpathStoreApi } from "@/features/workspace/providers/workspace-stores";
import type { GcodeExportResult } from "@/features/workspace/stores/toolpath-scheduler";
import { downloadFile } from "@/lib/download";
import { cn } from "@/lib/utils";

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The toolpath worker posts the program from the toolpaths
 * it already computed for the document on screen (#133, ADR-0004), computing
 * only those it lacks or that changed since. Disabled while `disabledReason`
 * says why.
 */
export function GcodeExportButton({
  name,
  disabledReason,
  className,
}: {
  name: string;
  disabledReason?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const toolpaths = useToolpathStoreApi();

  async function onClick() {
    setPending(true);
    let result: GcodeExportResult;
    try {
      result = await toolpaths.getState().controls.exportGcode(name);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      setPending(false);
    }
    if ("error" in result) {
      window.alert(result.error);
      return;
    }
    downloadFile(result.gcode, result.fileName, "text/plain");
    if (result.warnings.length > 0) {
      window.alert(`The G-code was exported with warnings:\n\n${result.warnings.join("\n")}`);
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
