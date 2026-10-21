"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { downloadFile } from "@furrow/ui/lib/download";
import { formatWarning } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { FileCodeIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { track } from "../lib/telemetry";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useDocumentStoreApi, useToolpathStoreApi } from "../providers/workspace-stores";
import type { GcodeExportResult } from "../stores/toolpath-scheduler";

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The toolpath worker posts the program from the toolpaths
 * it already computed for the document on screen (#133, ADR-0004), computing
 * only those it lacks or that changed since. Disabled while `disabledReason`
 * says why. Without an account, it explains how to get one instead (PRD-0008 G6).
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
  const t = useTranslations();
  // Read when the program is made, so a rename while it is made counts.
  const latestName = useRef(name);
  latestName.current = name;
  const toolpaths = useToolpathStoreApi();
  const documents = useDocumentStoreApi();
  const { account } = useWorkspaceHost();

  async function onClick() {
    if (account) {
      account.prompt("export-gcode");
      return;
    }
    setPending(true);
    let result: GcodeExportResult;
    try {
      result = await toolpaths.getState().controls.exportGcode(() => latestName.current);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      setPending(false);
    }
    if ("error" in result) {
      window.alert(formatWarning(t, { operation: result.operation, message: result.error }));
      return;
    }
    downloadFile(result.gcode, result.fileName, "text/plain");
    const machine = documents.getState().document.machine;
    if (machine) track({ event: "gcode_exported", postProcessor: machine.postProcessor });
    if (result.warnings.length > 0) {
      const warnings = result.warnings.map((warning) => formatWarning(t, warning)).join("\n");
      window.alert(`${t("Shell.exportedWithWarnings")}\n\n${warnings}`);
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
      {t("Shell.exportGcode")}
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
