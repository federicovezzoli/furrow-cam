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
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";

/** Why STL import is off: the server has no storage for meshes (ADR-0029). */
export const STL_IMPORT_OFF: Message = { code: "workspace.stlImportOff" };

/**
 * Picks an STL file and imports it as a model (PRD-0005 S1), from the import
 * card. Disabled while a file imports and, saying why, when
 * the server can't store meshes.
 */
export function ModelImportButton() {
  const t = useTranslations("Import");
  const format = useFormatMessage();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const host = useWorkspaceHost();
  const limits = host.limits.meshes;
  const importing = useWorkspaceStore(
    (s) => s.modelImport !== null && s.modelImport.error === null,
  );
  const input = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file && limits)
      void importModel(file, { meshes: host.meshes, limits, document, workspace });
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".stl,model/stl"
        onChange={onChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      <Button
        variant="outline"
        size="compact"
        disabled={!limits || importing}
        title={limits ? undefined : format(STL_IMPORT_OFF)}
        onClick={() => input.current?.click()}
        className="justify-self-start"
      >
        <FileBoxIcon />
        {t("importStl")}
      </Button>
    </>
  );
}
