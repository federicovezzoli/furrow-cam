"use client";

import {
  DEFAULT_SVG_DPI,
  type DxfDocument,
  DxfImportError,
  dxfNeedsUnits,
  importDxf,
  importSvg,
  parseDxf,
  parseSvg,
  type SvgDocument,
  SvgImportError,
  svgNeedsDpi,
} from "@furrow/cam-core";
import type { Units } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { UploadIcon, XIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, type ReactNode, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { track } from "../lib/telemetry";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../providers/workspace-stores";
import { addImportedShapes, canImportDrawing, DRAWINGS_OR_MODEL } from "../stores/geometry-actions";
import { ModelImportButton, STL_IMPORT_OFF } from "./model-import-button";

/** Files are parsed in the browser; anything larger is unlikely to be a drawing worth cutting. */
const MAX_FILE_SIZE = 20_000_000;

/** Common pixels per inch in SVG files; editors let users pick any. */
const DPI_OPTIONS = [96, 72, 90, 300] as const;

type Notice = { kind: "error" | "info"; messages: Translatable[] };

/** What a drawing unit is in a DXF file that doesn't say. */
const UNIT_OPTIONS = ["mm", "in"] as const;

/**
 * A file waiting for the user: an SVG sized in pixels, or not at all, for its
 * DPI; a DXF with no units for them.
 */
type PendingFile =
  | { kind: "svg"; svg: SvgDocument; name: string }
  | { kind: "dxf"; dxf: DxfDocument; name: string };

/** A parsed file and what to import it with. */
type ImportRequest =
  | { kind: "svg"; svg: SvgDocument; name: string; dpi: number }
  | { kind: "dxf"; dxf: DxfDocument; name: string; units: Units };

function isImportError(error: unknown): error is SvgImportError | DxfImportError {
  return error instanceof SvgImportError || error instanceof DxfImportError;
}

/** The file input `GeometryImport` reads drawings from, which `ImportDrawingButton` opens. */
const DRAWING_INPUT_ID = "workspace-drawing-file";

/**
 * The top bar's button importing another drawing once the project holds some
 * (the empty project's card has its own). It opens `GeometryImport`'s file
 * input, which handles the file.
 */
export function ImportDrawingButton() {
  const shown = useDocumentStore(
    (s) => s.document.geometry.length > 0 && canImportDrawing(s.document),
  );
  const t = useTranslations("Import");
  if (!shown) return null;
  return (
    <Button
      variant="ghost"
      size="compact"
      data-tour="import"
      // shortcut: finds the input by id, so only one workspace per page; share a ref if that changes.
      onClick={() => document.getElementById(DRAWING_INPUT_ID)?.click()}
    >
      <UploadIcon />
      {t("importDrawing")}
    </Button>
  );
}

/**
 * Imports SVG and DXF files and STL models, over the viewport: a card in its
 * centre while the project is empty; then the top bar's `ImportDrawingButton`
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
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const format = useFormatMessage();
  const t = useTranslations("Import");
  /** Counts picks, so a slow file read can't land after the user picked another file. */
  const picks = useRef(0);

  function fail(error: unknown) {
    if (!isImportError(error)) console.error(error);
    const message = isImportError(error) ? error.detail : { code: "workspace.importFailed" };
    setNotice({ kind: "error", messages: [message] });
  }

  function add(request: ImportRequest) {
    try {
      const { shapes, warnings } =
        request.kind === "svg"
          ? importSvg(request.svg, { dpi: request.dpi, fileName: request.name })
          : importDxf(request.dxf, { units: request.units, fileName: request.name });
      if (shapes.length === 0) {
        setNotice({ kind: "error", messages: [{ code: "workspace.noShapes" }, ...warnings] });
        return;
      }
      if (!addImportedShapes(store, request.kind === "svg" ? "importSvg" : "importDxf", shapes)) {
        // A model was imported, or a step redone, while the file was read or the prompt open.
        setNotice({ kind: "error", messages: [DRAWINGS_OR_MODEL] });
        return;
      }
      track({ event: "file_imported", format: request.kind });
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
        messages: [{ code: "workspace.fileTooLarge", values: { mb: MAX_FILE_SIZE / 1_000_000 } }],
      });
      return;
    }
    try {
      const name = picked.name;
      if (/\.dxf$/i.test(name)) {
        // DXF files name their encoding inside, so they are decoded from bytes.
        const bytes = new Uint8Array(await picked.arrayBuffer());
        if (pick !== picks.current) return;
        const dxf = parseDxf(bytes);
        if (dxfNeedsUnits(dxf)) {
          setNotice(null);
          setPending({ kind: "dxf", dxf, name });
        } else {
          add({ kind: "dxf", dxf, name, units: "mm" });
        }
        return;
      }
      const text = await picked.text();
      if (pick !== picks.current) return;
      const svg = parseSvg(text);
      if (svgNeedsDpi(svg)) {
        setNotice(null);
        setPending({ kind: "svg", svg, name });
      } else {
        add({ kind: "svg", svg, name, dpi: DEFAULT_SVG_DPI });
      }
    } catch (error) {
      if (pick === picks.current) fail(error);
    }
  }

  /** Nothing to show over the viewport: the top bar has the import button. */
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
            data-tour={empty ? "import" : undefined}
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
                  add({ ...pending, dpi });
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
                  add({ ...pending, units });
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
