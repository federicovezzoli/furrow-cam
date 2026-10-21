"use client";

import { closedPathsInside, pickablePaths } from "@furrow/cam-core";
import type { Operation } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { cn } from "@furrow/ui/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useTargetsLabel } from "../hooks/use-targets-label";
import { selectionTargets } from "../lib/path-selection";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import {
  addDrillOperation,
  addEngraveOperation,
  addPocketOperation,
  addProfileOperation,
  addReliefFinishOperation,
  addReliefRoughOperation,
  addVCarveOperation,
  deleteOperation,
  moveOperation,
  renameOperation,
  setOperationEnabled,
} from "../stores/operation-actions";
import { OperationNameInput } from "./operation-name-input";
import { OperationTypeIcon } from "./operation-type-icon";
import {
  cuttingToolChoice,
  defaultToolChoice,
  drillToolChoice,
  engraveToolChoice,
  reliefFinishToolChoice,
  reliefRoughToolChoice,
  useToolLibrary,
  vcarveToolChoice,
} from "./tool-library";

/**
 * The Operations pane: shows the selected paths, adds profiles, pockets,
 * drill, engrave and V-carve operations from the selected paths and 3D
 * operations on the project's model, and lists operations in cutting order.
 */
export function OperationsPane() {
  const t = useTranslations("Operations");
  const targetsLabel = useTargetsLabel();
  // Why profiles, pockets and 3D operations can't be added with only drill bits in the library.
  const sideways = t("sideways");
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const operations = useDocumentStore((s) => s.document.operations);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const targets = useMemo(
    () => selectionTargets(geometry, selectedPaths),
    [geometry, selectedPaths],
  );
  const tools = useToolLibrary();
  const { Link } = useWorkspaceHost().navigation;
  const tool = defaultToolChoice(tools);
  const cuttingTool = cuttingToolChoice(tools);
  const drillTool = drillToolChoice(tools);
  const engraveTool = engraveToolChoice(tools);
  const vcarveTool = vcarveToolChoice(tools);
  const models = useDocumentStore((s) => s.document.models);
  const selectedModelId = useWorkspaceStore((s) => s.selectedModelId);
  // The selected model, or the project's only one.
  const model =
    models.find(({ id }) => id === selectedModelId) ?? (models.length === 1 ? models[0] : null);

  function add(addOperation: typeof addProfileOperation, choice: typeof tool, name: string) {
    if (!choice) return;
    const id = addOperation(store, { targets, tool: choice.tool, name });
    if (id) workspace.getState().selectOperation(id);
  }

  const target = targets.length === 0 ? undefined : targetsLabel(targets);

  const kinds: {
    type: Operation["type"];
    label: string;
    addOperation: typeof addProfileOperation;
    choice: typeof tool;
    hint: string;
    /** Why there is no fitting tool when the library has others. */
    missingTool: string;
  }[] = [
    {
      type: "profile",
      label: t("types.profile"),
      addOperation: addProfileOperation,
      choice: cuttingTool,
      hint: t("hints.profile", { target: target ?? "" }),
      missingTool: sideways,
    },
    {
      type: "pocket",
      label: t("types.pocket"),
      addOperation: addPocketOperation,
      choice: cuttingTool,
      hint: t("hints.pocket", { target: target ?? "" }),
      missingTool: sideways,
    },
    {
      type: "drill",
      label: t("types.drill"),
      addOperation: addDrillOperation,
      choice: drillTool,
      hint: t("hints.drill", { target: target ?? "" }),
      missingTool: t("missingDrill"),
    },
    {
      type: "engrave",
      label: t("types.engrave"),
      addOperation: addEngraveOperation,
      choice: engraveTool,
      hint: t("hints.engrave", { target: target ?? "" }),
      missingTool: t("missingEngrave"),
    },
    {
      type: "vcarve",
      label: t("types.vcarve"),
      addOperation: addVCarveOperation,
      choice: vcarveTool,
      hint: t("hints.vcarve", { target: target ?? "" }),
      missingTool: t("missingVCarve"),
    },
  ];

  const modelKinds: {
    type: Operation["type"];
    label: string;
    addOperation: typeof addReliefFinishOperation;
    choice: typeof tool;
    hint: string;
    missingTool: string;
  }[] = [
    {
      type: "relief_rough",
      label: t("types.relief_rough"),
      addOperation: addReliefRoughOperation,
      choice: reliefRoughToolChoice(tools),
      missingTool: sideways,
      hint: t("hints.relief_rough", { model: model?.fileName ?? "" }),
    },
    {
      type: "relief_finish",
      label: t("types.relief_finish"),
      addOperation: addReliefFinishOperation,
      choice: reliefFinishToolChoice(tools),
      missingTool: sideways,
      hint: t("hints.relief_finish", { model: model?.fileName ?? "" }),
    },
  ];

  return (
    <div className="grid gap-2 p-3 text-ui">
      {models.length > 0 && (
        <div className="@container">
          <div className="grid grid-cols-3 gap-1 @[17rem]:grid-cols-5">
            {modelKinds.map(({ type, label, addOperation, choice, hint, missingTool }) => {
              const disabledReason = !choice
                ? tool
                  ? missingTool
                  : t("noTool")
                : !model
                  ? t("selectModel")
                  : undefined;
              const button = (
                <Button
                  key={type}
                  variant="outline"
                  disabled={disabledReason !== undefined}
                  onClick={() => {
                    if (!model || !choice) return;
                    const id = addOperation(store, {
                      modelId: model.id,
                      tool: choice.tool,
                      name: label,
                    });
                    if (id) workspace.getState().selectOperation(id);
                  }}
                  aria-label={t("addLabel", { operation: label })}
                  title={disabledReason === undefined ? hint : undefined}
                  className="h-auto min-w-0 flex-col gap-1 px-0.5 py-2 has-[>svg]:px-0.5 text-ui"
                >
                  <OperationTypeIcon type={type} />
                  <span className="max-w-full truncate text-ui-label">{label}</span>
                </Button>
              );
              return disabledReason === undefined ? (
                button
              ) : (
                // A disabled button gets no pointer events, so its wrapper shows why.
                <span key={type} title={disabledReason} className="grid min-w-0">
                  {button}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <Selection
        target={target}
        onClear={() => workspace.getState().selectPaths([])}
        onSelectInside={() => {
          const { selectedPaths, selectPaths } = workspace.getState();
          selectPaths([
            ...selectedPaths,
            ...closedPathsInside(pickablePaths(geometry), selectedPaths),
          ]);
        }}
      />
      {(geometry.length > 0 || models.length === 0) && (
        <div className="@container">
          <div className="grid grid-cols-3 gap-1 @[17rem]:grid-cols-5">
            {kinds.map(({ type, label, addOperation, choice, hint, missingTool }) => {
              const disabledReason = !choice
                ? tool
                  ? missingTool
                  : t("noTool")
                : !target
                  ? t("selectPaths")
                  : undefined;
              const button = (
                <Button
                  key={type}
                  variant="outline"
                  disabled={disabledReason !== undefined}
                  onClick={() => add(addOperation, choice, label)}
                  aria-label={t("addLabel", { operation: label })}
                  title={disabledReason === undefined ? hint : undefined}
                  className="h-auto min-w-0 flex-col gap-1 px-0.5 py-2 has-[>svg]:px-0.5 text-ui"
                >
                  <OperationTypeIcon type={type} />
                  <span className="max-w-full truncate text-ui-label">{label}</span>
                </Button>
              );
              if (disabledReason === undefined) return button;
              // A disabled button gets no pointer events, so its wrapper shows why.
              return (
                <span key={type} title={disabledReason} className="grid min-w-0">
                  {button}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {tool && !target && geometry.length > 0 && (
        <p className="text-muted-foreground">{t("selectHint")}</p>
      )}
      {!tool && (
        <p className="text-muted-foreground">
          {t.rich("addToolLibrary", {
            link: (chunks) => (
              <Link to="tools" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {operations.length > 0 && (
        <ol aria-label={t("inCuttingOrder")} className="grid gap-0.5">
          {operations.map((operation, index) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              first={index === 0}
              last={index === operations.length - 1}
              index={index}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * What is selected (`target`), if anything, with a way to add the closed
 * paths inside it (a pocket's islands) and a way to clear it.
 */
function Selection({
  target,
  onClear,
  onSelectInside,
}: {
  target: string | undefined;
  onClear: () => void;
  onSelectInside: () => void;
}) {
  const t = useTranslations("Operations");
  if (!target) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1">
      <p className="flex-[1_1_7rem] first-letter:uppercase">{target}</p>
      <div className="ml-auto flex">
        <Button
          variant="ghost"
          size="compact"
          onClick={onSelectInside}
          title={t("selectInsideTitle")}
        >
          {t("selectInside")}
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={onClear}
          aria-label={t("clearSelection")}
          title={t("clearSelection")}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}

function OperationRow({
  operation,
  index,
  first,
  last,
}: {
  operation: Operation;
  index: number;
  first: boolean;
  last: boolean;
}) {
  const t = useTranslations("Operations");
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const selected = useWorkspaceStore((s) => s.selectedOperationId === operation.id);
  const [renaming, setRenaming] = useState(false);

  function select() {
    workspace.getState().selectOperation(selected ? null : operation.id);
  }

  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md pl-1.5",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <input
        type="checkbox"
        checked={operation.enabled}
        onChange={(event) => setOperationEnabled(store, operation.id, event.target.checked)}
        aria-label={t("enableLabel", { name: operation.name })}
        title={operation.enabled ? t("enabled") : t("disabled")}
        className="size-3.5 shrink-0 accent-primary"
      />
      <span
        aria-hidden
        className="size-2 shrink-0"
        style={{ backgroundColor: operation.tool.color }}
        title={operation.tool.name}
      />
      {renaming ? (
        <OperationNameInput
          name={operation.name}
          onRename={(name) => renameOperation(store, operation.id, name)}
          onDone={() => setRenaming(false)}
          autoFocus
          aria-label={t("operationName")}
        />
      ) : (
        <button
          type="button"
          onClick={select}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(event) => {
            if (event.key === "F2") setRenaming(true);
          }}
          aria-pressed={selected}
          title={t("renameTitle")}
          className={cn(
            "min-w-0 flex-1 truncate py-1 text-left outline-none focus-visible:underline",
            !operation.enabled && "text-muted-foreground line-through",
          )}
        >
          {operation.name}
        </button>
      )}
      {operation.enabled && (
        <>
          <ToolpathStatus operationId={operation.id} />
          <ToolpathVisibility operation={operation} />
        </>
      )}
      <Button
        variant="ghost"
        size="icon-compact"
        disabled={first}
        onClick={() => moveOperation(store, operation.id, index - 1)}
        aria-label={t("moveUpLabel", { name: operation.name })}
        title={t("moveUp")}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        disabled={last}
        onClick={() => moveOperation(store, operation.id, index + 1)}
        aria-label={t("moveDownLabel", { name: operation.name })}
        title={t("moveDown")}
      >
        <ArrowDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        onClick={() => {
          deleteOperation(store, operation.id);
          if (selected) workspace.getState().selectOperation(null);
        }}
        aria-label={t("deleteLabel", { name: operation.name })}
        title={t("delete")}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/** Shows or hides an operation's toolpath in the viewport. */
function ToolpathVisibility({ operation }: { operation: Operation }) {
  const t = useTranslations("Operations");
  const workspace = useWorkspaceStoreApi();
  const hidden = useWorkspaceStore((s) => s.hiddenToolpathIds.includes(operation.id));
  const Icon = hidden ? EyeOffIcon : EyeIcon;
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      onClick={() => workspace.getState().setToolpathVisible(operation.id, hidden)}
      aria-label={t("toolpathOf", { name: operation.name })}
      aria-pressed={!hidden}
      title={hidden ? t("showToolpath") : t("hideToolpath")}
      className={cn(hidden && "text-muted-foreground")}
    >
      <Icon />
    </Button>
  );
}

/** An icon for an enabled operation's toolpath: computing, failed, or computed with warnings. */
export function ToolpathStatus({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  const t = useTranslations("Operations");
  const format = useFormatMessage();
  if (!entry) return null;
  if (entry.status === "computing") {
    const label =
      entry.progress === undefined
        ? t("computing")
        : t("computingPercent", { percent: Math.floor(entry.progress * 100) });
    return (
      <LoaderCircleIcon
        role="img"
        aria-label={label}
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      >
        <title>{label}</title>
      </LoaderCircleIcon>
    );
  }
  if (entry.status === "error" && entry.cancelled) {
    return (
      <CircleSlashIcon
        role="img"
        aria-label={t("cancelled")}
        className="size-3.5 shrink-0 text-muted-foreground"
      >
        <title>{t("cancelledDetail")}</title>
      </CircleSlashIcon>
    );
  }
  if (entry.status === "error") {
    return (
      <CircleAlertIcon
        role="img"
        aria-label={t("failed", { error: format(entry.error) })}
        className="size-3.5 shrink-0 text-destructive"
      >
        <title>{format(entry.error)}</title>
      </CircleAlertIcon>
    );
  }
  // Messages from cam-core, translated for the label and tooltip (ADR-0054).
  const warnings = entry.warnings.map(format);
  if (warnings.length === 0) return null;
  return (
    <TriangleAlertIcon
      role="img"
      aria-label={t("warnings", { warnings: warnings.join(" ") })}
      className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
    >
      <title>{warnings.join("\n")}</title>
    </TriangleAlertIcon>
  );
}
