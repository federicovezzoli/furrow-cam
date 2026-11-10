"use client";

import { type PathRef, pathKey } from "@furrow/cam-core";
import { operationModelId, type Shape } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { cn } from "@furrow/ui/lib/utils";
import {
  BoxIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LockOpenIcon,
  ShapesIcon,
  SplineIcon,
  TypeIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useFlaggedIds } from "../hooks/use-flagged-ids";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { setObjectFlag } from "../stores/geometry-actions";

/** One row of the tree, in the order shown. */
type Row = {
  key: string;
  level: 1 | 2 | 3;
  kind: "drawing" | "shape" | "path" | "model";
  /** The drawing, shape or model; a path row's shape. */
  id: string;
  /** The drawing a shape or path row is in. */
  drawingId: string | null;
  label: string;
  /** The paths selecting the row selects; none for a model. */
  paths: PathRef[];
  /** `null` when the row has no rows below it. */
  expanded: boolean | null;
  parent: string | null;
  text: boolean;
  /** Its own flags, which its eye and lock show and set. */
  hidden: boolean;
  locked: boolean;
};

const allPaths = (shape: Shape): PathRef[] =>
  shape.paths.map((_, path) => ({ shapeId: shape.id, path }));

/**
 * What the project holds (ADR-0080): each drawing, its shapes and a shape's
 * paths when it has several, then the model, with an eye and a lock on each
 * drawing, shape and model. Selecting a row selects what it stands for, as a
 * click in the viewport does, and a row inside a drawing enters it; the
 * viewport's selection shows here too, and a selected operation's targets
 * are marked. Hidden rows are dimmed and can't be selected; locked ones can.
 * An ARIA tree: arrows move and expand, Enter or Space selects, with
 * Shift/Ctrl/Cmd to add.
 */
export function ObjectsPane() {
  const t = useTranslations("Objects");
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const drawings = useDocumentStore((s) => s.document.drawings);
  const geometry = useDocumentStore((s) => s.document.geometry);
  const models = useDocumentStore((s) => s.document.models);
  const hiddenIds = useFlaggedIds("hidden");
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const selectedModelId = useWorkspaceStore((s) => s.selectedModelId);
  const operationId = useWorkspaceStore((s) => s.selectedOperationId);
  const operation = useDocumentStore((s) =>
    s.document.operations.find(({ id }) => id === operationId),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const rows = useMemo(() => {
    const list: Row[] = [];
    for (const drawing of drawings) {
      const shapes = geometry.filter((shape) => shape.drawingId === drawing.id);
      const open = expanded.has(drawing.id);
      list.push({
        key: drawing.id,
        level: 1,
        kind: "drawing",
        id: drawing.id,
        drawingId: null,
        label: drawing.name || t("untitled"),
        // Hidden shapes aren't selected with their drawing, as in the viewport.
        paths: shapes.filter(({ id }) => !hiddenIds.has(id)).flatMap(allPaths),
        expanded: shapes.length > 0 ? open : null,
        parent: null,
        text: drawing.text !== undefined,
        hidden: drawing.hidden === true,
        locked: drawing.locked === true,
      });
      if (!open) continue;
      shapes.forEach((shape, i) => {
        const several = shape.paths.length > 1;
        const shapeOpen = several && expanded.has(shape.id);
        list.push({
          key: shape.id,
          level: 2,
          kind: "shape",
          id: shape.id,
          drawingId: drawing.id,
          label: shape.name || shape.layer || t("shape", { n: i + 1 }),
          paths: allPaths(shape),
          expanded: several ? shapeOpen : null,
          parent: drawing.id,
          text: false,
          hidden: shape.hidden === true,
          locked: shape.locked === true,
        });
        if (!shapeOpen) return;
        for (const ref of allPaths(shape)) {
          list.push({
            key: pathKey(ref),
            level: 3,
            kind: "path",
            id: shape.id,
            drawingId: drawing.id,
            label: t("path", { n: ref.path + 1 }),
            paths: [ref],
            expanded: null,
            parent: shape.id,
            text: false,
            hidden: false,
            locked: false,
          });
        }
      });
    }
    for (const model of models) {
      list.push({
        key: model.id,
        level: 1,
        kind: "model",
        id: model.id,
        drawingId: null,
        label: model.fileName,
        paths: [],
        expanded: null,
        parent: null,
        text: false,
        hidden: model.hidden === true,
        locked: model.locked === true,
      });
    }
    return list;
  }, [drawings, geometry, models, expanded, hiddenIds, t]);

  const selectedKeys = useMemo(() => new Set(selectedPaths.map(pathKey)), [selectedPaths]);
  /** What the selected operation cuts: whole shapes, paths and its model. */
  const targeted = useMemo(() => {
    const keys = new Set<string>();
    if (!operation) return keys;
    const modelId = operationModelId(operation);
    if (modelId) keys.add(modelId);
    for (const { shapeId, paths } of operation.targets) {
      const shape = geometry.find(({ id }) => id === shapeId);
      if (!shape) continue;
      for (const path of paths ?? shape.paths.map((_, i) => i)) keys.add(`${shapeId}:${path}`);
    }
    return keys;
  }, [operation, geometry]);

  const isSelected = (row: Row) =>
    row.kind === "model"
      ? row.id === selectedModelId
      : row.paths.length > 0 && row.paths.every((ref) => selectedKeys.has(pathKey(ref)));
  const isTargeted = (row: Row) =>
    row.kind === "model"
      ? targeted.has(row.id)
      : row.paths.length > 0 && row.paths.every((ref) => targeted.has(pathKey(ref)));
  // A drawing's flag covers its shapes and their paths.
  const isHidden = (row: Row) =>
    row.kind === "path" ? hiddenIds.has(row.id) : hiddenIds.has(row.id) || row.hidden;

  function select(row: Row, add: boolean) {
    if (isHidden(row)) return;
    const state = workspace.getState();
    if (row.kind === "model") {
      state.selectModel(row.id);
      return;
    }
    state.selectPaths(row.paths, add ? "toggle" : "replace");
    state.enterDrawing(row.drawingId);
  }

  function toggle(row: Row, open: boolean) {
    if (row.expanded === null || row.expanded === open) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
  }

  function focus(key: string) {
    setFocusKey(key);
    rowRefs.current.get(key)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, row: Row, index: number) {
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target) focus(target.key);
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.expanded === false) toggle(row, true);
        else if (row.expanded) move(index + 1);
        break;
      case "ArrowLeft":
        if (row.expanded) toggle(row, false);
        else if (row.parent) focus(row.parent);
        break;
      case "Enter":
      case " ":
        select(row, event.shiftKey || event.ctrlKey || event.metaKey);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  if (rows.length === 0) {
    return <p className="p-3 text-muted-foreground text-ui">{t("empty")}</p>;
  }
  // One row takes the Tab key: the focused one, else the first.
  const tabbable = rows.some(({ key }) => key === focusKey) ? focusKey : rows[0]?.key;

  return (
    <div role="tree" aria-label={t("label")} aria-multiselectable className="grid p-2 text-ui">
      {rows.map((row, index) => {
        const hidden = isHidden(row);
        const Icon =
          row.kind === "model"
            ? BoxIcon
            : row.kind === "path"
              ? SplineIcon
              : row.text
                ? TypeIcon
                : ShapesIcon;
        return (
          <div
            key={row.key}
            ref={(element) => {
              if (element) rowRefs.current.set(row.key, element);
              else rowRefs.current.delete(row.key);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-selected={isSelected(row)}
            aria-expanded={row.expanded ?? undefined}
            aria-disabled={hidden || undefined}
            tabIndex={row.key === tabbable ? 0 : -1}
            onFocus={() => setFocusKey(row.key)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) onKeyDown(event, row, index);
            }}
            onClick={(event) => select(row, event.shiftKey || event.ctrlKey || event.metaKey)}
            className={cn(
              "flex min-w-0 cursor-default items-center gap-1 rounded-md py-0.5 pr-1 outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isSelected(row) ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
              hidden && "text-muted-foreground opacity-60",
            )}
            style={{ paddingLeft: `${(row.level - 1) * 16 + 4}px` }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {row.expanded !== null && (
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", row.expanded && "rotate-90")}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(row, !row.expanded);
                  }}
                />
              )}
            </span>
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={row.label}>
              {row.label}
            </span>
            {isTargeted(row) && (
              <span
                role="img"
                aria-label={t("targeted")}
                title={t("targeted")}
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
            {row.kind !== "path" && (
              <>
                <FlagButton
                  on={row.hidden}
                  label={t(row.hidden ? "show" : "hide", { name: row.label })}
                  Icon={row.hidden ? EyeOffIcon : EyeIcon}
                  onClick={() => setObjectFlag(store, row.id, "hidden", !row.hidden)}
                />
                <FlagButton
                  on={row.locked}
                  label={t(row.locked ? "unlock" : "lock", { name: row.label })}
                  Icon={row.locked ? LockIcon : LockOpenIcon}
                  onClick={() => setObjectFlag(store, row.id, "locked", !row.locked)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** An eye or a lock: faint until set, so a set one stands out in the list. */
function FlagButton({
  on,
  label,
  Icon,
  onClick,
}: {
  on: boolean;
  label: string;
  Icon: typeof EyeIcon;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn("shrink-0", !on && "text-muted-foreground/50")}
    >
      <Icon />
    </Button>
  );
}
