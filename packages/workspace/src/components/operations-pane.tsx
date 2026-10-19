"use client";

import { closedPathsInside, pickablePaths } from "@furrow/cam-core";
import type { Operation } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
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
import { selectionTargets, targetsLabel } from "../lib/path-selection";
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
/** Why profiles, pockets and 3D operations can't be added with only drill bits in the library. */
const SIDEWAYS = "Add an end mill or a V-bit to your tool library: drill bits can't cut sideways";

export function OperationsPane() {
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

  function add(addOperation: typeof addProfileOperation, choice = tool) {
    if (!choice) return;
    const id = addOperation(store, { targets, tool: choice.tool });
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
    missingTool?: string;
  }[] = [
    {
      type: "profile",
      label: "Profile",
      addOperation: addProfileOperation,
      choice: cuttingTool,
      hint: `Cut around the ${target}`,
      missingTool: tool ? SIDEWAYS : undefined,
    },
    {
      type: "pocket",
      label: "Pocket",
      addOperation: addPocketOperation,
      choice: cuttingTool,
      hint: `Clear the area inside the ${target}`,
      missingTool: tool ? SIDEWAYS : undefined,
    },
    {
      type: "drill",
      label: "Drill",
      addOperation: addDrillOperation,
      choice: drillTool,
      hint: `Drill the points and circles of the ${target}`,
      missingTool: tool
        ? "Add a drill or an end mill to your tool library: V-bits can't drill"
        : undefined,
    },
    {
      type: "engrave",
      label: "Engrave",
      addOperation: addEngraveOperation,
      choice: engraveTool,
      hint: `Engrave along the lines of the ${target}`,
      missingTool: tool
        ? "Add a V-bit or an end mill to your tool library: drill bits can't engrave"
        : undefined,
    },
    {
      type: "vcarve",
      label: "V-carve",
      addOperation: addVCarveOperation,
      choice: vcarveTool,
      hint: `Carve inside the ${target} with a V-bit, deeper where they are wider`,
      missingTool: tool ? "Add a V-bit to your tool library to V-carve" : undefined,
    },
  ];

  const modelKinds: {
    type: Operation["type"];
    label: string;
    addOperation: typeof addReliefFinishOperation;
    choice: typeof tool;
    hint: string;
    missingTool?: string;
  }[] = [
    {
      type: "relief_rough",
      label: "3D rough",
      addOperation: addReliefRoughOperation,
      choice: reliefRoughToolChoice(tools),
      missingTool: tool ? SIDEWAYS : undefined,
      hint: `Clear the material above ${model?.fileName} in levels, a flat end mill being the usual choice`,
    },
    {
      type: "relief_finish",
      label: "3D finish",
      addOperation: addReliefFinishOperation,
      choice: reliefFinishToolChoice(tools),
      missingTool: tool ? SIDEWAYS : undefined,
      hint: `Finish ${model?.fileName} with parallel passes, a ball end mill being the usual choice`,
    },
  ];

  return (
    <div className="grid gap-2 p-3 text-ui">
      {models.length > 0 && (
        <div className="@container">
          <div className="grid grid-cols-3 gap-1 @[17rem]:grid-cols-5">
            {modelKinds.map(({ type, label, addOperation, choice, hint, missingTool }) => {
              const disabledReason = !choice
                ? (missingTool ?? "Add a tool to your tool library first")
                : !model
                  ? "Select a model in the viewport first"
                  : undefined;
              const button = (
                <Button
                  key={type}
                  variant="outline"
                  disabled={disabledReason !== undefined}
                  onClick={() => {
                    if (!model || !choice) return;
                    const id = addOperation(store, { modelId: model.id, tool: choice.tool });
                    if (id) workspace.getState().selectOperation(id);
                  }}
                  aria-label={`Add ${label}`}
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
                ? (missingTool ?? "Add a tool to your tool library first")
                : !target
                  ? "Select paths in the viewport first"
                  : undefined;
              const button = (
                <Button
                  key={type}
                  variant="outline"
                  disabled={disabledReason !== undefined}
                  onClick={() => add(addOperation, choice)}
                  aria-label={`Add ${type}`}
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
        <p className="text-muted-foreground">
          Click paths in the top view to select what to cut; Ctrl/Cmd/Shift+click to select more.
        </p>
      )}
      {!tool && (
        <p className="text-muted-foreground">
          Add a tool to your{" "}
          <Link to="tools" className="underline underline-offset-2">
            tool library
          </Link>{" "}
          to create operations.
        </p>
      )}

      {operations.length > 0 && (
        <ol aria-label="Operations in cutting order" className="grid gap-0.5">
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
  if (!target) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1">
      <p className="flex-[1_1_7rem] first-letter:uppercase">{target}</p>
      <div className="ml-auto flex">
        <Button
          variant="ghost"
          size="compact"
          onClick={onSelectInside}
          title="Also select the closed paths inside the selected ones, such as a pocket's islands"
        >
          Select inside
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
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
        aria-label={`Enable ${operation.name}`}
        title={operation.enabled ? "Enabled" : "Disabled: no toolpath"}
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
          aria-label="Operation name"
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
          title="Double-click or press F2 to rename"
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
        aria-label={`Move ${operation.name} up`}
        title="Move up"
      >
        <ArrowUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        disabled={last}
        onClick={() => moveOperation(store, operation.id, index + 1)}
        aria-label={`Move ${operation.name} down`}
        title="Move down"
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
        aria-label={`Delete ${operation.name}`}
        title="Delete"
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/** Shows or hides an operation's toolpath in the viewport. */
function ToolpathVisibility({ operation }: { operation: Operation }) {
  const workspace = useWorkspaceStoreApi();
  const hidden = useWorkspaceStore((s) => s.hiddenToolpathIds.includes(operation.id));
  const Icon = hidden ? EyeOffIcon : EyeIcon;
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      onClick={() => workspace.getState().setToolpathVisible(operation.id, hidden)}
      aria-label={`Toolpath of ${operation.name}`}
      aria-pressed={!hidden}
      title={hidden ? "Show toolpath" : "Hide toolpath"}
      className={cn(hidden && "text-muted-foreground")}
    >
      <Icon />
    </Button>
  );
}

/** An icon for an enabled operation's toolpath: computing, failed, or computed with warnings. */
export function ToolpathStatus({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  if (!entry) return null;
  if (entry.status === "computing") {
    const label =
      entry.progress === undefined
        ? "Computing toolpath"
        : `Computing toolpath, ${Math.floor(entry.progress * 100)}%`;
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
        aria-label="Toolpath cancelled"
        className="size-3.5 shrink-0 text-muted-foreground"
      >
        <title>{entry.error}</title>
      </CircleSlashIcon>
    );
  }
  if (entry.status === "error") {
    return (
      <CircleAlertIcon
        role="img"
        aria-label={`Toolpath failed: ${entry.error}`}
        className="size-3.5 shrink-0 text-destructive"
      >
        <title>{entry.error}</title>
      </CircleAlertIcon>
    );
  }
  const { warnings } = entry;
  if (warnings.length === 0) return null;
  return (
    <TriangleAlertIcon
      role="img"
      aria-label={`Toolpath warnings: ${warnings.join(" ")}`}
      className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
    >
      <title>{warnings.join("\n")}</title>
    </TriangleAlertIcon>
  );
}
