"use client";

import type { Operation } from "@furrow/document";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { selectionTargets, targetsLabel } from "@/features/workspace/lib/path-selection";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import {
  addDrillOperation,
  addPocketOperation,
  addProfileOperation,
  deleteOperation,
  moveOperation,
  renameOperation,
  setOperationEnabled,
} from "@/features/workspace/stores/operation-actions";
import { OperationNameInput } from "./operation-name-input";
import { defaultToolChoice, drillToolChoice, useToolLibrary } from "./tool-library";

/** The Operations pane: adds profiles, pockets and drill operations from the selected paths and lists operations in cutting order. */
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
  const tool = defaultToolChoice(tools);
  const drillTool = drillToolChoice(tools);

  function add(addOperation: typeof addProfileOperation, choice = tool) {
    if (!choice) return;
    const id = addOperation(store, { targets, tool: choice.tool });
    if (id) workspace.getState().selectOperation(id);
  }

  const target = targets.length === 0 ? undefined : targetsLabel(targets);

  return (
    <div className="grid gap-2 p-3 text-ui">
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="compact"
          disabled={!target || !tool}
          onClick={() => add(addProfileOperation)}
          title={target && `Cut around the ${target}`}
        >
          <PlusIcon />
          Add profile
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!target || !tool}
          onClick={() => add(addPocketOperation)}
          title={target && `Clear the area inside the ${target}`}
        >
          <PlusIcon />
          Add pocket
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!target || !drillTool}
          onClick={() => add(addDrillOperation, drillTool)}
          title={
            tool && !drillTool
              ? "Add a drill or an end mill to your tool library: V-bits can't drill"
              : target && `Drill the points and circles of the ${target}`
          }
        >
          <PlusIcon />
          Add drill
        </Button>
      </div>
      {target && tool && <p className="text-muted-foreground">For the {target}.</p>}
      {!tool ? (
        <p className="text-muted-foreground">
          Add a tool to your{" "}
          <Link href="/tools" className="underline underline-offset-2">
            tool library
          </Link>{" "}
          to create operations.
        </p>
      ) : (
        !target && (
          <p className="text-muted-foreground">
            Select the shapes to cut in the Geometry pane, or paths in the top view, then add an
            operation for them.
          </p>
        )
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
    return (
      <LoaderCircleIcon
        role="img"
        aria-label="Computing toolpath"
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      >
        <title>Computing toolpath</title>
      </LoaderCircleIcon>
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
