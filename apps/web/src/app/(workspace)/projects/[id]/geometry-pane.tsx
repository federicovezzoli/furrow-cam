"use client";

import {
  closedPathsInside,
  DEFAULT_SVG_DPI,
  importSvg,
  parseSvg,
  pickablePaths,
  type SvgDocument,
  SvgImportError,
  svgNeedsDpi,
} from "@furrow/cam-core";
import { cn } from "cn";
import { UploadIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { pathKey, selectionTargets, shapePaths, targetsLabel } from "@/lib/path-selection";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/stores/workspace-stores";

/** Files are parsed in the browser; anything larger is unlikely to be a drawing worth cutting. */
const MAX_FILE_SIZE = 20_000_000;

/** Common pixels per inch in SVG files; editors let users pick any. */
const DPI_OPTIONS = [96, 72, 90, 300] as const;

type Notice = { kind: "error" | "info"; messages: string[] };

/** A file sized in pixels, or not at all, waiting for the user's DPI. */
type PendingFile = { svg: SvgDocument; name: string };

/**
 * The Geometry pane: imports SVG files and lists the project's shapes. A
 * click selects all of a shape's paths; Ctrl/Cmd/Shift+click adds or removes
 * them. A shape with only some paths selected (in the viewport) says how many.
 */
export function GeometryPane() {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const shapes = useDocumentStore((s) => s.document.geometry);
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const selected = useMemo(() => new Set(selectedPaths.map(pathKey)), [selectedPaths]);
  const targets = useMemo(() => selectionTargets(shapes, selectedPaths), [shapes, selectedPaths]);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Counts picks, so a slow file read can't land after the user picked another file. */
  const picks = useRef(0);

  function fail(error: unknown) {
    if (!(error instanceof SvgImportError)) console.error(error);
    const message =
      error instanceof SvgImportError ? error.message : "This file couldn't be imported.";
    setNotice({ kind: "error", messages: [message] });
  }

  function add(file: PendingFile, dpi: number) {
    try {
      const { shapes, warnings } = importSvg(file.svg, { dpi, fileName: file.name });
      if (shapes.length === 0) {
        setNotice({ kind: "error", messages: ["This file has no shapes to import.", ...warnings] });
        return;
      }
      store.getState().change("importSvg", (draft) => {
        // One by one: spreading a huge array into arguments overflows the stack.
        for (const shape of shapes) draft.geometry.push(shape);
      });
      setNotice(warnings.length > 0 ? { kind: "info", messages: warnings } : null);
    } catch (error) {
      fail(error);
    }
  }

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (!picked) return;
    const pick = ++picks.current;
    setPending(null);
    if (picked.size > MAX_FILE_SIZE) {
      setNotice({
        kind: "error",
        messages: ["This file is too large to import (the limit is 20 MB)."],
      });
      return;
    }
    try {
      const text = await picked.text();
      if (pick !== picks.current) return;
      const file = { svg: parseSvg(text), name: picked.name };
      if (svgNeedsDpi(file.svg)) {
        setNotice(null);
        setPending(file);
      } else {
        add(file, DEFAULT_SVG_DPI);
      }
    } catch (error) {
      if (pick === picks.current) fail(error);
    }
  }

  return (
    <div className="grid gap-2 p-3 text-ui">
      <div>
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          onChange={onChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <Button variant="outline" size="compact" onClick={() => input.current?.click()}>
          <UploadIcon />
          Import SVG…
        </Button>
      </div>

      {pending && (
        <DpiPrompt
          fileName={pending.name}
          onImport={(dpi) => {
            setPending(null);
            add(pending, dpi);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error"
              ? "grid gap-1 text-destructive"
              : "grid gap-1 text-muted-foreground"
          }
        >
          {notice.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      {shapes.length === 0 ? (
        <p className="text-muted-foreground">Import an SVG or DXF file to add geometry.</p>
      ) : (
        <SelectionHint
          label={targets.length > 0 ? targetsLabel(targets) : null}
          onClear={() => workspace.getState().selectPaths([])}
          onSelectInside={() => {
            const { selectedPaths, selectPaths } = workspace.getState();
            const inside = closedPathsInside(pickablePaths(shapes), selectedPaths);
            selectPaths([...selectedPaths, ...inside]);
          }}
        />
      )}
      {shapes.length > 0 && (
        <ul aria-label="Shapes" className="grid gap-0.5">
          {shapes.map((shape) => {
            const count = shape.paths.reduce(
              (n, _, path) => n + (selected.has(pathKey({ shapeId: shape.id, path })) ? 1 : 0),
              0,
            );
            const all = count === shape.paths.length;
            return (
              <li key={shape.id}>
                <button
                  type="button"
                  aria-pressed={all ? true : count > 0 ? "mixed" : false}
                  onClick={(event) =>
                    workspace
                      .getState()
                      .selectPaths(
                        shapePaths(shape),
                        event.ctrlKey || event.metaKey || event.shiftKey ? "toggle" : "replace",
                      )
                  }
                  onPointerEnter={() =>
                    workspace.getState().setHovered({ shapeId: shape.id, path: null })
                  }
                  onPointerLeave={() => workspace.getState().setHovered(null)}
                  className={cn(
                    "flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    all
                      ? "bg-accent text-accent-foreground"
                      : count > 0
                        ? "bg-accent/50 hover:bg-accent/70"
                        : "hover:bg-muted/60",
                  )}
                >
                  <span className="truncate">{shape.name || "Unnamed shape"}</span>
                  {count > 0 && !all && (
                    <span className="shrink-0 tabular-nums">
                      {count} of {shape.paths.length} paths
                    </span>
                  )}
                  {shape.layer && (
                    <span className="ml-auto shrink-0 truncate text-muted-foreground">
                      {shape.layer}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * How to select shapes while none are, else what is (`label`), a way to add
 * the closed paths inside it (a pocket's islands) and a way to clear it.
 */
function SelectionHint({
  label,
  onClear,
  onSelectInside,
}: {
  label: string | null;
  onClear: () => void;
  onSelectInside: () => void;
}) {
  if (label === null) {
    return (
      <p className="text-muted-foreground">
        Click a shape here, or a path in the top view, to select it for an operation;
        Ctrl/Cmd/Shift+click to select more.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <p className="flex-1">{label}</p>
      <Button
        variant="ghost"
        size="compact"
        onClick={onSelectInside}
        title="Also select the closed paths inside the selected ones, such as a pocket's islands"
      >
        Select inside
      </Button>
      <Button variant="ghost" size="compact" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/** Asks what a pixel is in a file whose size depends on it and doesn't say. */
function DpiPrompt({
  fileName,
  onImport,
  onCancel,
}: {
  fileName: string;
  onImport: (dpi: number) => void;
  onCancel: () => void;
}) {
  const [dpi, setDpi] = useState<number>(DEFAULT_SVG_DPI);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onImport(dpi);
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Pixels per inch"
      className="grid gap-2 rounded-md border bg-muted/40 p-2"
    >
      <p>
        <span className="font-medium break-all">{fileName}</span> gives its size in pixels, or not
        at all. How many pixels make an inch? Check the export settings of the program that made it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="svg-dpi" className="text-ui font-normal">
          DPI
        </Label>
        <NativeSelect
          id="svg-dpi"
          size="sm"
          value={dpi}
          onChange={(event) => setDpi(Number(event.target.value))}
          className="h-control px-2 pr-7 text-ui"
        >
          {DPI_OPTIONS.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {value}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="compact">
          Import
        </Button>
        <Button type="button" variant="ghost" size="compact" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
