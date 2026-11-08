"use client";

import type { Message } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { FileBoxIcon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { useTranslations } from "use-intl";
import { importModel } from "../lib/model-import";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { canImportModel, ONE_MODEL } from "../stores/geometry-actions";
import { RibbonButton } from "./ribbon";

/** Why STL import is off: the server has no storage for meshes (ADR-0029). */
export const STL_IMPORT_OFF: Message = { code: "workspace.stlImportOff" };

/**
 * Picks an STL or STEP file and imports it as a model (PRD-0005 S1), from the empty
 * project's import card or the ribbon (`inRibbon`). Disabled while a file imports
 * and, saying why, when the server can't store meshes or, in the ribbon, when the
 * project already has its one model (ADR-0078).
 */
export function ModelImportButton({ inRibbon = false }: { inRibbon?: boolean }) {
  const t = useTranslations("Import");
  const ribbon = useTranslations("Ribbon");
  const format = useFormatMessage();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const host = useWorkspaceHost();
  const limits = host.limits.meshes;
  const importing = useWorkspaceStore(
    (s) => s.modelImport !== null && s.modelImport.error === null,
  );
  const allowed = useDocumentStore((s) => canImportModel(s.document));
  const input = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file && limits)
      void importModel(file, { meshes: host.meshes, limits, document, workspace });
  }

  const file = (
    <input
      ref={input}
      type="file"
      accept=".stl,.step,.stp,model/stl,model/step"
      onChange={onChange}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
    />
  );

  if (inRibbon)
    return (
      <>
        {file}
        <RibbonButton
          icon={<FileBoxIcon />}
          label={ribbon("model")}
          aria-label={ribbon("importModel")}
          hint={t("importModel")}
          disabledReason={
            !limits ? format(STL_IMPORT_OFF) : allowed ? undefined : format(ONE_MODEL)
          }
          disabled={importing}
          onClick={() => input.current?.click()}
        />
      </>
    );
  return (
    <>
      {file}
      <Button
        variant="outline"
        size="compact"
        disabled={!limits || importing}
        title={limits ? undefined : format(STL_IMPORT_OFF)}
        data-demo="import-model"
        onClick={() => input.current?.click()}
        className="justify-self-start"
      >
        <FileBoxIcon />
        {t("importModel")}
      </Button>
    </>
  );
}
