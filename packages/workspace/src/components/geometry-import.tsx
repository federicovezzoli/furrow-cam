"use client";

import { DEFAULT_SVG_DPI } from "@furrow/cam-core";
import { DEFAULT_LINE_SPACING, type Units } from "@furrow/document";
import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { TypeIcon, UploadIcon, XIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, type ReactNode, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
  DRAWING_FILE_TOO_LARGE,
  type DrawingFile,
  drawingFileNeeds,
  importDrawingFile,
  isDrawingImportError,
  MAX_DRAWING_FILE_SIZE,
  parseDrawingFile,
} from "../lib/drawing-import";
import { DEFAULT_FONT } from "../lib/fonts";
import { track } from "../lib/telemetry";
import { addText } from "../lib/text-items";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { canImportDrawing, DRAWINGS_OR_MODEL, drawingShapes } from "../stores/geometry-actions";
import { ModelImportButton, STL_IMPORT_OFF } from "./model-import-button";
import { RibbonButton } from "./ribbon";

/** Common pixels per inch in SVG files; editors let users pick any. */
const DPI_OPTIONS = [96, 72, 90, 300] as const;

type Notice = { kind: "error" | "info"; messages: Translatable[] };

/** What a drawing unit is in a DXF file that doesn't say. */
const UNIT_OPTIONS = ["mm", "in"] as const;

/** The file input `GeometryImport` reads drawings from, which `ImportDrawingButton` opens. */
const DRAWING_INPUT_ID = "workspace-drawing-file";

/**
 * The ribbon's button importing a drawing, disabled in a model project. It
 * opens `GeometryImport`'s file input, which handles the file.
 */
export function ImportDrawingButton() {
  const allowed = useDocumentStore((s) => canImportDrawing(s.document));
  const t = useTranslations("Import");
  const ribbon = useTranslations("Ribbon");
  const format = useFormatMessage();
  return (
    <RibbonButton
      icon={<UploadIcon />}
      label={ribbon("drawing")}
      aria-label={ribbon("importDrawing")}
      hint={t("importDrawing")}
      disabledReason={allowed ? undefined : format(DRAWINGS_OR_MODEL)}
      // shortcut: finds the input by id, so only one workspace per page; share a ref if that changes.
      onClick={() => document.getElementById(DRAWING_INPUT_ID)?.click()}
    />
  );
}

/** A new text item's cap height, in millimetres. */
const DEFAULT_TEXT_HEIGHT = 20;

/**
 * Adds a text item (PRD-0010 T1), placed like an imported drawing, and
 * selects it so its properties open. In the ribbon, disabled in a model
 * project like `ImportDrawingButton`, or in the empty project's card
 * (`inCard`).
 */
export function AddTextButton({ inCard = false }: { inCard?: boolean }) {
  const allowed = useDocumentStore((s) => canImportDrawing(s.document));
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const { alert } = useDialogs();
  const format = useFormatMessage();
  const [adding, setAdding] = useState(false);
  const t = useTranslations("Import");
  const ribbon = useTranslations("Ribbon");

  async function add() {
    setAdding(true);
    const result = await addText(store, {
      text: t("defaultText"),
      font: DEFAULT_FONT,
      height: DEFAULT_TEXT_HEIGHT,
      align: "left",
      lineSpacing: DEFAULT_LINE_SPACING,
      letterSpacing: 0,
      placement: { position: [0, 0], rotation: 0, mirrored: false },
    });
    setAdding(false);
    if (!result.ok) return alert(format(result.error));
    const [shape] = drawingShapes(store.getState().document.geometry, result.id);
    if (shape)
      workspace.getState().selectPaths(shape.paths.map((_, path) => ({ shapeId: shape.id, path })));
  }

  if (!inCard)
    return (
      <RibbonButton
        icon={<TypeIcon />}
        label={ribbon("text")}
        aria-label={t("addText")}
        hint={t("addText")}
        disabledReason={allowed ? undefined : format(DRAWINGS_OR_MODEL)}
        disabled={adding}
        onClick={add}
      />
    );
  return (
    <Button variant="outline" size="compact" disabled={adding} onClick={add}>
      <TypeIcon />
      {t("addText")}
    </Button>
  );
}

/**
 * Imports SVG and DXF files and STL models, over the viewport: a card in its
 * centre while the project is empty; then the ribbon's `ImportDrawingButton`
 * adds a drawing per file while the project holds drawings; a project holds
 * drawings or one model (ADR-0055). Prompts, import warnings (until
 * dismissed) and how an STL import is going show in the viewport's corner.
 */
export function GeometryImport() {
  const store = useDocumentStoreApi();
  const empty = useDocumentStore(
    (s) => s.document.geometry.length === 0 && s.document.models.length === 0,
  );
  const drawings = useDocumentStore((s) => canImportDrawing(s.document));
  const meshLimits = useWorkspaceHost().limits.meshes;
  const modelImport = useWorkspaceStore((s) => s.modelImport);
  const setModelImport = useWorkspaceStore((s) => s.setModelImport);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<DrawingFile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const format = useFormatMessage();
  const t = useTranslations("Import");
  /** Counts picks, so a slow file read can't land after the user picked another file. */
  const picks = useRef(0);

  function fail(error: unknown) {
    if (!isDrawingImportError(error)) console.error(error);
    const message = isDrawingImportError(error) ? error.detail : { code: "workspace.importFailed" };
    setNotice({ kind: "error", messages: [message] });
  }

  function add(file: DrawingFile, { dpi = DEFAULT_SVG_DPI, units = "mm" as Units } = {}) {
    try {
      const result = importDrawingFile(store, file, { dpi, units });
      if (!result.ok) {
        // Also when a model was imported, or a step redone, while the file was read or the prompt open.
        setNotice({ kind: "error", messages: result.messages });
        return;
      }
      track({ event: "file_imported", format: file.kind });
      const { warnings } = result;
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
    if (picked.size > MAX_DRAWING_FILE_SIZE) {
      setNotice({ kind: "error", messages: [DRAWING_FILE_TOO_LARGE] });
      return;
    }
    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      if (pick !== picks.current) return;
      const file = parseDrawingFile(picked.name, bytes);
      if (drawingFileNeeds(file)) {
        setNotice(null);
        setPending(file);
      } else {
        add(file);
      }
    } catch (error) {
      if (pick === picks.current) fail(error);
    }
  }

  /** Nothing to show over the viewport: the ribbon has the import button. */
  const bare = !empty && !pending && !notice && !modelImport;

  return (
    <>
      {drawings && (
        <input
          ref={input}
          id={DRAWING_INPUT_ID}
          type="file"
          accept=".svg,.dxf,image/svg+xml,image/vnd.dxf"
          onChange={onChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      )}
      {!bare && (
        <div
          className={cn(
            "pointer-events-none absolute flex",
            empty
              ? "inset-0 items-center justify-center p-4"
              : "right-2 bottom-2 left-2 justify-end",
          )}
        >
          <div
            className={cn(
              "pointer-events-auto grid gap-2 rounded-md border bg-background/85 text-ui shadow-xs backdrop-blur-md",
              "w-full max-w-72 p-3",
            )}
          >
            {empty && <p className="text-muted-foreground">{t("start")}</p>}
            {empty && (
              <div className="flex flex-wrap gap-2">
                {drawings && (
                  <Button variant="outline" size="compact" onClick={() => input.current?.click()}>
                    <UploadIcon />
                    {t("importDrawing")}
                  </Button>
                )}
                {drawings && <AddTextButton inCard />}
                <ModelImportButton />
              </div>
            )}
            {empty && !meshLimits && (
              <p className="text-muted-foreground">{format(STL_IMPORT_OFF)}</p>
            )}

            {pending?.kind === "svg" && (
              <ImportPrompt
                id="svg-dpi"
                label={t("dpi")}
                title={t("dpiTitle")}
                question={t.rich("dpiQuestion", {
                  file: pending.name,
                  name: (chunks) => <span className="font-medium break-all">{chunks}</span>,
                })}
                options={DPI_OPTIONS.map((value) => ({ value, label: String(value) }))}
                initial={DEFAULT_SVG_DPI}
                onImport={(dpi) => {
                  setPending(null);
                  add(pending, { dpi });
                }}
                onCancel={() => setPending(null)}
              />
            )}
            {pending?.kind === "dxf" && (
              <ImportPrompt
                id="dxf-units"
                label={t("units_")}
                title={t("unitsTitle")}
                question={t.rich("unitsQuestion", {
                  file: pending.name,
                  name: (chunks) => <span className="font-medium break-all">{chunks}</span>,
                })}
                options={UNIT_OPTIONS.map((value) => ({ value, label: t(`units.${value}`) }))}
                initial="mm"
                onImport={(units: Units) => {
                  setPending(null);
                  add(pending, { units });
                }}
                onCancel={() => setPending(null)}
              />
            )}

            {modelImport && (
              <div className="flex items-start gap-1">
                {modelImport.error === null ? (
                  <p role="status" className="flex-1 break-all text-muted-foreground">
                    {t("importing", { file: modelImport.fileName })}
                  </p>
                ) : (
                  <>
                    <div role="alert" className="grid flex-1 gap-1 text-destructive">
                      <p className="font-medium break-all">{modelImport.fileName}</p>
                      <p>{format(modelImport.error)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      onClick={() => setModelImport(null)}
                      aria-label={t("dismiss")}
                      title={t("dismiss")}
                      className="-mt-1 -mr-1"
                    >
                      <XIcon />
                    </Button>
                  </>
                )}
              </div>
            )}

            {notice && (
              <div className="flex items-start gap-1">
                <div
                  role={notice.kind === "error" ? "alert" : "status"}
                  className={cn(
                    "grid flex-1 gap-1",
                    notice.kind === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {notice.messages.map((message) => (
                    <p key={JSON.stringify(message)}>{format(message)}</p>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  onClick={() => setNotice(null)}
                  aria-label={t("dismiss")}
                  title={t("dismiss")}
                  className="-mt-1 -mr-1"
                >
                  <XIcon />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Asks what the file doesn't say but importing it depends on: an SVG's DPI or a DXF's units. */
function ImportPrompt<T extends string | number>({
  id,
  label,
  title,
  question,
  options,
  initial,
  onImport,
  onCancel,
}: {
  id: string;
  label: string;
  /** The form's accessible name. */
  title: string;
  question: ReactNode;
  options: readonly { value: T; label: string }[];
  initial: T;
  onImport: (value: T) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<T>(initial);
  const t = useTranslations("Import");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onImport(value);
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={title}
      className="grid gap-2 rounded-md border bg-muted/40 p-2"
    >
      <p>{question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="text-ui font-normal">
          {label}
        </Label>
        <NativeSelect
          id={id}
          size="sm"
          value={String(value)}
          onChange={(event) => {
            const picked = options.find((option) => String(option.value) === event.target.value);
            if (picked) setValue(picked.value);
          }}
          className="h-control px-2 pr-7 text-ui"
        >
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={String(option.value)}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="compact">
          {t("import")}
        </Button>
        <Button type="button" variant="ghost" size="compact" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
