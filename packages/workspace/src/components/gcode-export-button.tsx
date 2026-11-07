"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { downloadFile } from "@furrow/ui/lib/download";
import { formatWarning } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { FileCodeIcon } from "lucide-react";
import { useRef } from "react";
import { useTranslations } from "use-intl";
import { track } from "../lib/telemetry";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useToolpathStoreApi,
} from "../providers/workspace-stores";
import { hasEnabledOperations } from "../stores/document-store";
import type { GcodeExportResult } from "../stores/toolpath-scheduler";

/** Milliseconds between the downloads of one export's files. */
const DOWNLOAD_GAP = 500;

/**
 * Downloads the open project's G-code for its machine's post-processor
 * (PRD-0001 R11). The toolpath worker posts the program from the toolpaths
 * it already computed for the document on screen (#133, ADR-0004), computing
 * only those it lacks or that changed since. The workspace and the simulator
 * show it; disabled without a machine or an enabled operation, and while an
 * export started on either page runs. Without an account, it explains how to
 * get one instead (PRD-0008 G6).
 */
export function GcodeExportButton({ className }: { className?: string }) {
  const t = useTranslations();
  const { project, account } = useWorkspaceHost();
  const { name } = project;
  const hasMachine = useDocumentStore((s) => s.document.machine !== null);
  const canCut = useDocumentStore(hasEnabledOperations);
  const pending = useToolpathStore((s) => s.exporting);
  const disabledReason =
    // Without an account, the button explains what it needs instead.
    !hasMachine && !account
      ? t("Shell.chooseMachine")
      : !canCut
        ? t("Shell.addOperation")
        : undefined;
  // Read when the program is made, so a rename while it is made counts.
  const latestName = useRef(name);
  latestName.current = name;
  const toolpaths = useToolpathStoreApi();
  const documents = useDocumentStoreApi();
  const { alert } = useDialogs();

  async function onClick() {
    if (account) {
      account.prompt("export-gcode");
      return;
    }
    if (toolpaths.getState().exporting) return;
    toolpaths.getState().setExporting(true);
    let result: GcodeExportResult;
    try {
      result = await toolpaths.getState().controls.exportGcode(() => latestName.current);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      toolpaths.getState().setExporting(false);
    }
    if ("error" in result) {
      void alert(formatWarning(t, { operation: result.operation, message: result.error }));
      return;
    }
    // One file per side in a two-sided project (ADR-0060), a moment apart:
    // some browsers save only the first of downloads started together.
    for (const [i, file] of result.files.entries()) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_GAP));
      downloadFile(file.gcode, file.fileName, "text/plain");
    }
    const machine = documents.getState().document.machine;
    if (machine) track({ event: "gcode_exported", postProcessor: machine.postProcessor });
    // Said, so a file the browser didn't save is missed.
    const notes =
      result.files.length > 1
        ? [t("Shell.exportedFiles", { files: result.files.map((f) => f.fileName).join(", ") })]
        : [];
    if (result.warnings.length > 0) {
      const warnings = result.warnings.map((warning) => formatWarning(t, warning)).join("\n");
      notes.push(`${t("Shell.exportedWithWarnings")}\n\n${warnings}`);
    }
    if (notes.length > 0) void alert(notes.join("\n\n"));
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
