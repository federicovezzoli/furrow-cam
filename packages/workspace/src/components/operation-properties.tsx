"use client";

import { cutsHidden } from "@furrow/cam-core";
import { type Operation, stockPins, type Tool, toolProblem } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useFlaggedIds } from "../hooks/use-flagged-ids";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import {
  hasPlacedHoles,
  renameOperation,
  setOperationTool,
  toolError,
} from "../stores/operation-actions";
import { EditBitButton } from "./edit-bit-dialog";
import { NewBitDialog } from "./new-bit-dialog";
import { OperationNameInput } from "./operation-name-input";
import { DrillFields } from "./operation-properties/drill-fields";
import { EngraveFields } from "./operation-properties/engrave-fields";
import { Row, SELECT_CLASS } from "./operation-properties/fields";
import { PocketFields } from "./operation-properties/pocket-fields";
import { ProfileFields } from "./operation-properties/profile-fields";
import { ReliefFinishFields } from "./operation-properties/relief-finish-fields";
import { ReliefRoughFields } from "./operation-properties/relief-rough-fields";
import { ModelField, TargetsField } from "./operation-properties/targets-field";
import { VCarveFields } from "./operation-properties/vcarve-fields";
import { PROPERTIES_HEADER } from "./properties-header";
import { matchingToolChoice, useToolLibrary } from "./tool-library";

/** The selected operation's name, tool, shapes and params. */
export function OperationProperties({ operationId }: { operationId: string }) {
  const operation = useDocumentStore((s) =>
    s.document.operations.find((candidate) => candidate.id === operationId),
  );
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const t = useTranslations("Operation");
  const tOperations = useTranslations("Operations");
  const hasPins = useDocumentStore((s) => !!stockPins(s.document.stock));
  const hidden = useFlaggedIds("hidden");
  if (!operation) return null;
  // Off while anything it cuts is hidden: no toolpath comes (ADR-0080).
  const allHidden = cutsHidden(operation, hidden);
  // A drill on the top side may cut the locating pins (#356) instead of shapes.
  const pins =
    operation.type !== "drill"
      ? null
      : operation.params.pins
        ? "on"
        : hasPins && operation.stockSide === "top"
          ? "available"
          : null;

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className={PROPERTIES_HEADER}>
        <h3 className="min-w-0 flex-1 truncate font-medium">{operation.name}</h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectOperation(null)}
          aria-label={t("closeLabel")}
          data-demo="close-operation"
          title={t("close")}
        >
          <XIcon />
        </Button>
      </div>

      <Row id="operation-name" label={t("name")}>
        <OperationNameInput
          id="operation-name"
          name={operation.name}
          onRename={(name) => renameOperation(store, operation.id, name)}
        />
      </Row>
      <ToolPicker operation={operation} />
      {operation.type === "relief_finish" || operation.type === "relief_rough" ? (
        <ModelField modelId={operation.params.modelId} />
      ) : (
        <TargetsField
          operationId={operation.id}
          targets={operation.targets}
          pins={pins}
          placedHoles={hasPlacedHoles(operation)}
        />
      )}
      {operation.type === "profile" && <ProfileFields operation={operation} />}
      {operation.type === "pocket" && <PocketFields operation={operation} />}
      {operation.type === "drill" && <DrillFields operation={operation} />}
      {operation.type === "engrave" && <EngraveFields operation={operation} />}
      {operation.type === "vcarve" && <VCarveFields operation={operation} />}
      {operation.type === "relief_rough" && <ReliefRoughFields operation={operation} />}
      {operation.type === "relief_finish" && <ReliefFinishFields operation={operation} />}
      {allHidden ? (
        <p className="text-muted-foreground">{tOperations("targetsHidden")}</p>
      ) : operation.enabled ? (
        <ToolpathDetails operationId={operation.id} />
      ) : (
        <p className="text-muted-foreground">{t("disabled")}</p>
      )}
    </div>
  );
}

/** The tool select's last option, which opens the form for a new bit instead of picking one. */
const NEW_BIT = "__new";

/**
 * Picks the operation's tool from the library, then the catalog; tools the
 * operation can't take, such as a V-bit to drill, are disabled. "New bit…"
 * creates one in place and picks it.
 */
function ToolPicker({ operation }: { operation: Operation }) {
  const store = useDocumentStoreApi();
  const t = useTranslations("Operation");
  const tools = useToolLibrary();
  const { id: operationId, tool } = operation;
  // The same check `setOperationTool` makes.
  const usable = useMemo(
    () =>
      new Set(
        tools
          .filter((choice) => toolError(operation, choice.tool) === null)
          .map((choice) => choice.id),
      ),
    [tools, operation],
  );
  const current = matchingToolChoice(tools, tool);
  const library = { label: t("yourBits"), choices: tools.filter((choice) => !choice.catalog) };
  const catalog = { label: t("catalog"), choices: tools.filter((choice) => choice.catalog) };
  // Cleared once the operation's tool changes.
  const format = useFormatMessage();
  const [rejected, setRejected] = useState<{ tool: Tool; error: Translatable } | null>(null);
  // A tool saved before it was refused, e.g. a drill bit on a profile, until another is picked.
  const error = (rejected?.tool === tool ? rejected.error : null) ?? toolProblem(operation);
  const [creating, setCreating] = useState(false);

  function pick(picked: Tool) {
    const result = setOperationTool(store, operationId, picked);
    setRejected(result.ok ? null : { tool, error: result.error });
  }

  return (
    <>
      <Row id="operation-tool" label={t("tool")}>
        {/* Lets a long tool name shrink the select instead of pushing the button out. */}
        <div className="flex min-w-0 items-center gap-1 *:data-[slot=native-select-wrapper]:min-w-0">
          <NativeSelect
            id="operation-tool"
            size="sm"
            value={current?.id ?? ""}
            onChange={(event) => {
              // Controlled, so the select keeps showing the current tool meanwhile.
              if (event.target.value === NEW_BIT) return setCreating(true);
              const choice = tools.find((candidate) => candidate.id === event.target.value);
              if (choice) pick(choice.tool);
            }}
            className={SELECT_CLASS}
          >
            {!current && (
              // The snapshot differs from every library tool (edited or deleted since it was picked).
              <NativeSelectOption value="">{t("asPicked", { name: tool.name })}</NativeSelectOption>
            )}
            {[library, catalog].map(
              (group) =>
                group.choices.length > 0 && (
                  <NativeSelectOptGroup key={group.label} label={group.label}>
                    {group.choices.map((choice) => (
                      <NativeSelectOption
                        key={choice.id}
                        value={choice.id}
                        disabled={!usable.has(choice.id)}
                      >
                        {choice.tool.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ),
            )}
            <hr />
            <NativeSelectOption value={NEW_BIT}>{t("newBit")}</NativeSelectOption>
          </NativeSelect>
          <EditBitButton choice={current} />
        </div>
      </Row>
      <NewBitDialog
        operation={operation}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(saved) => {
          setCreating(false);
          // A bit the operation can't take stays in the library; the error says why.
          pick(saved.tool);
        }}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {format(error)}
        </p>
      )}
    </>
  );
}

/**
 * The toolpath's state from the worker, with its error or warnings spelt out,
 * and how far it got with a way to cancel it when it reports that.
 */
function ToolpathDetails({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  const controls = useToolpathStore((s) => s.controls);
  const format = useFormatMessage();
  const t = useTranslations("Operation");
  if (!entry || entry.status === "computing") {
    const progress = entry?.status === "computing" ? entry.progress : undefined;
    if (progress === undefined) {
      return <p className="text-muted-foreground">{t("computing")}</p>;
    }
    const percent = Math.floor(progress * 100);
    return (
      <div className="flex items-center gap-2">
        <label htmlFor="toolpath-progress" className="shrink-0 text-muted-foreground">
          {t("computing")}
        </label>
        <progress
          id="toolpath-progress"
          max={100}
          value={percent}
          className="h-1.5 min-w-0 flex-1 accent-primary"
        >
          {percent}%
        </progress>
        <span aria-hidden className="shrink-0 text-muted-foreground tabular-nums">
          {percent}%
        </span>
        <Button variant="outline" size="compact" onClick={() => controls.cancel(operationId)}>
          {t("cancel")}
        </Button>
      </div>
    );
  }
  if (entry.status === "error" && entry.cancelled) {
    return (
      <div className="flex items-center gap-2">
        <p className="flex-1 text-muted-foreground">{t("cancelled")}</p>
        <Button variant="outline" size="compact" onClick={() => controls.retry(operationId)}>
          {t("computeAgain")}
        </Button>
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <p role="alert" className="text-destructive">
        {t("failed", { error: format(entry.error) })}
      </p>
    );
  }
  const { warnings } = entry;
  if (warnings.length === 0) return null;
  return (
    <section aria-label={t("warnings")} className="grid gap-1 text-amber-700 dark:text-amber-500">
      {warnings.map((warning) => (
        <p key={JSON.stringify(warning)}>{format(warning)}</p>
      ))}
    </section>
  );
}
