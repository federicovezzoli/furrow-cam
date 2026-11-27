"use client";

import type { Message } from "@furrow/document";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { FileBoxIcon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { useTranslations } from "use-intl";
import { importModel } from "../lib/model-import";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { RibbonButton } from "./ribbon";

/** Why STL import is off: the server has no storage for meshes (ADR-0029). */
export const STL_IMPORT_OFF: Message = { code: "workspace.stlImportOff" };

/**
 * The ribbon's button picking an STL or STEP file and importing it as a model
 * (PRD-0005 S1). Disabled while a file imports and, saying why, when the
 * server can't store meshes.
 */
export function ModelImportButton() {
  const t = useTranslations("Import");
  const ribbon = useTranslations("Ribbon");
  const format = useFormatMessage();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const host = useWorkspaceHost();
  const limits = host.limits.meshes;
  const importing = useWorkspaceStore(
    (s) => s.modelImport !== null && s.modelImport.error === null && !s.modelImport.warning,
  );
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

  return (
    <>
      {file}
      <RibbonButton
        icon={<FileBoxIcon />}
        label={ribbon("model")}
        aria-label={ribbon("importModel")}
        data-demo="ribbon-import-model"
        hint={t("importModel")}
        disabledReason={limits ? undefined : format(STL_IMPORT_OFF)}
        disabled={importing}
        onClick={() => input.current?.click()}
      />
    </>
  );
}
