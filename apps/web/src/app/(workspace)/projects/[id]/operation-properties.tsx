"use client";

import {
  MillingDirection,
  type ProfileOperation,
  type ProfileParams,
  ProfileSide,
  type Tool,
} from "@furrow/document";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { DocumentStore } from "@/stores/document-store";
import {
  renameOperation,
  setOperationShapes,
  setOperationTool,
  updateProfileParams,
} from "@/stores/operation-actions";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/stores/workspace-stores";
import { OperationNameInput } from "./operation-name-input";
import { matchingToolChoice, useToolLibrary } from "./tool-library";

const SIDE_LABELS: Record<ProfileSide, string> = {
  outside: "Outside",
  inside: "Inside",
  on: "On the line",
};

const DIRECTION_LABELS: Record<MillingDirection, string> = {
  climb: "Climb",
  conventional: "Conventional",
};

/** Keeps depths and radii positive, as `ProfileParams` requires, when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

/** The selected operation's name, tool, shapes and params; replaces the stock while one is selected. */
export function OperationProperties({ operationId }: { operationId: string }) {
  const operation = useDocumentStore((s) =>
    s.document.operations.find((candidate) => candidate.id === operationId),
  );
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  if (!operation) return null;

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{operation.name}</h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectOperation(null)}
          aria-label="Close operation properties"
          title="Close"
        >
          <XIcon />
        </Button>
      </div>

      <Row id="operation-name" label="Name">
        <OperationNameInput
          id="operation-name"
          name={operation.name}
          onRename={(name) => renameOperation(store, operation.id, name)}
        />
      </Row>
      <ToolPicker operationId={operation.id} tool={operation.tool} />
      <ShapesField operationId={operation.id} shapeIds={operation.shapeIds} />
      {operation.type === "profile" && <ProfileFields operation={operation} />}
      {operation.enabled ? (
        <ToolpathDetails operationId={operation.id} />
      ) : (
        <p className="text-muted-foreground">Disabled: no toolpath is computed.</p>
      )}
    </div>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}

const SELECT_CLASS = "h-control px-2 pr-7 text-ui";

function ToolPicker({ operationId, tool }: { operationId: string; tool: Tool }) {
  const store = useDocumentStoreApi();
  const tools = useToolLibrary();
  const current = matchingToolChoice(tools, tool);

  return (
    <Row id="operation-tool" label="Tool">
      <NativeSelect
        id="operation-tool"
        size="sm"
        value={current?.id ?? ""}
        onChange={(event) => {
          const choice = tools.find((candidate) => candidate.id === event.target.value);
          if (choice) setOperationTool(store, operationId, choice.tool);
        }}
        className={SELECT_CLASS}
      >
        {!current && (
          // The snapshot differs from every library tool (edited or deleted since it was picked).
          <NativeSelectOption value="">{tool.name} (as picked)</NativeSelectOption>
        )}
        {tools.map((choice) => (
          <NativeSelectOption key={choice.id} value={choice.id}>
            {choice.tool.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Row>
  );
}

function ShapesField({ operationId, shapeIds }: { operationId: string; shapeIds: string[] }) {
  const store = useDocumentStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedShapeIds = useWorkspaceStore((s) => s.selectedShapeIds);
  const shapes = useMemo(() => {
    const ids = new Set(shapeIds);
    return geometry.filter((shape) => ids.has(shape.id));
  }, [geometry, shapeIds]);
  const selected = useMemo(() => {
    const ids = new Set(selectedShapeIds);
    return geometry.filter((shape) => ids.has(shape.id)).map((shape) => shape.id);
  }, [geometry, selectedShapeIds]);

  return (
    <section aria-labelledby="operation-shapes-heading" className="grid gap-1">
      <div className="flex items-center gap-2">
        <h4 id="operation-shapes-heading" className="flex-1">
          Shapes
        </h4>
        <Button
          variant="outline"
          size="compact"
          disabled={selected.length === 0}
          onClick={() => setOperationShapes(store, operationId, selected)}
          title="Cut the shapes selected in the Geometry pane instead"
        >
          Use selected ({selected.length})
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {shapes.map((shape) => (
          <li key={shape.id} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{shape.name || "Unnamed shape"}</span>
            <Button
              variant="ghost"
              size="icon-compact"
              disabled={shapes.length === 1}
              onClick={() =>
                setOperationShapes(
                  store,
                  operationId,
                  shapeIds.filter((id) => id !== shape.id),
                )
              }
              aria-label={`Remove ${shape.name || "unnamed shape"}`}
              title={shapes.length === 1 ? "An operation needs at least one shape" : "Remove"}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Begins and ends a document transaction around a number field's gesture (one undo step). */
function gestureHandlers(store: DocumentStore) {
  return {
    onGestureStart: () => store.getState().beginTransaction(),
    onGestureEnd: (cancelled: boolean) => {
      const state = store.getState();
      if (cancelled) state.cancelTransaction();
      else state.commitTransaction();
    },
  };
}

function ProfileFields({ operation }: { operation: ProfileOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  /** Why the last change was rejected, by field. */
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileParams, string>>>({});

  function update(field: keyof ProfileParams, changes: Partial<ProfileParams>) {
    const result = updateProfileParams(store, operation.id, changes);
    setErrors((previous) => ({ ...previous, [field]: result.ok ? undefined : result.error }));
  }

  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;

  return (
    <section aria-labelledby="profile-heading" className="grid gap-2">
      <h4 id="profile-heading" className="font-medium">
        Profile
      </h4>
      <Row id="profile-side" label="Side">
        <NativeSelect
          id="profile-side"
          size="sm"
          value={params.side}
          onChange={(event) => {
            const side = ProfileSide.parse(event.target.value);
            // On the line leaves no wall for an allowance to stay on.
            update("side", side === "on" ? { side, allowance: 0, finishPass: false } : { side });
          }}
          className={SELECT_CLASS}
        >
          {ProfileSide.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {SIDE_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row id="profile-direction" label="Direction">
        <NativeSelect
          id="profile-direction"
          size="sm"
          value={params.direction}
          onChange={(event) =>
            update("direction", { direction: MillingDirection.parse(event.target.value) })
          }
          className={SELECT_CLASS}
        >
          {MillingDirection.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {DIRECTION_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <NumberField
        id="profile-depth"
        label="Depth"
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      <NumberField
        id="profile-allowance"
        label="Allowance"
        min={0}
        value={params.allowance}
        disabled={params.side === "on"}
        onValueChange={(allowance) =>
          // Nothing left for a finish pass to remove.
          update("allowance", allowance === 0 ? { allowance, finishPass: false } : { allowance })
        }
        error={errors.allowance}
        {...length}
      />
      <Checkbox
        id="profile-finish-pass"
        label="Finish pass"
        hint={params.allowance === 0 ? "Needs an allowance to remove." : undefined}
        checked={params.finishPass}
        disabled={params.allowance === 0}
        onChange={(finishPass) => update("finishPass", { finishPass })}
      />
      <Checkbox
        id="profile-lead-in"
        label="Lead-in arc"
        checked={params.leadIn !== null}
        onChange={(checked) =>
          update("leadIn", { leadIn: checked ? { radius: tool.diameter } : null })
        }
      />
      {params.leadIn && (
        <NumberField
          id="profile-lead-in-radius"
          label="Lead-in radius"
          min={MIN_LENGTH}
          value={params.leadIn.radius}
          onValueChange={(radius) => update("leadIn", { leadIn: { radius } })}
          error={errors.leadIn}
          {...length}
        />
      )}
      <Checkbox
        id="profile-ramp"
        label="Ramp in"
        hint={`At the tool's plunge angle (${tool.plungeAngle}°).`}
        checked={params.ramp}
        onChange={(ramp) => update("ramp", { ramp })}
      />
      {(errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp}
        </p>
      )}
    </section>
  );
}

function Checkbox({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="size-3.5 accent-primary"
      />
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {hint && (
        <p id={`${id}-hint`} className="col-start-2 text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** The toolpath's state from the worker, with its error or warnings spelt out. */
function ToolpathDetails({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  if (!entry || entry.status === "computing") {
    return <p className="text-muted-foreground">Computing toolpath…</p>;
  }
  if (entry.status === "error") {
    return (
      <p role="alert" className="text-destructive">
        The toolpath couldn't be computed: {entry.error}
      </p>
    );
  }
  const { warnings } = entry.result;
  if (warnings.length === 0) return null;
  return (
    <section
      aria-label="Toolpath warnings"
      className="grid gap-1 text-amber-700 dark:text-amber-500"
    >
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </section>
  );
}
