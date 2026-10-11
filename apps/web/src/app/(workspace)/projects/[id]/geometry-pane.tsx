"use client";

import { DEFAULT_SVG_DPI, importSvg, SvgImportError, svgNeedsDpi } from "@furrow/cam-core";
import { UploadIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useDocumentStore, useDocumentStoreApi } from "@/stores/workspace-stores";

/** Files are parsed in the browser; anything larger is unlikely to be a drawing worth cutting. */
const MAX_FILE_SIZE = 20_000_000;

/** Common pixels per inch in SVG files; editors let users pick any. */
const DPI_OPTIONS = [96, 72, 90, 300] as const;

type Notice = { kind: "error" | "info"; messages: string[] };

/** A file sized in pixels, or not at all, waiting for the user's DPI. */
type PendingFile = { text: string; name: string };

/** The Geometry pane: imports SVG files and lists the project's shapes. */
export function GeometryPane() {
  const store = useDocumentStoreApi();
  const shapes = useDocumentStore((s) => s.document.geometry);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  function fail(error: unknown) {
    if (!(error instanceof SvgImportError)) console.error(error);
    const message =
      error instanceof SvgImportError ? error.message : "This file couldn't be imported.";
    setNotice({ kind: "error", messages: [message] });
  }

  function add(file: PendingFile, dpi: number) {
    try {
      const { shapes, warnings } = importSvg(file.text, { dpi, fileName: file.name });
      if (shapes.length === 0) {
        setNotice({ kind: "error", messages: ["This file has no shapes to import.", ...warnings] });
        return;
      }
      store.getState().change("importSvg", (draft) => {
        draft.geometry.push(...shapes);
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
    setPending(null);
    if (picked.size > MAX_FILE_SIZE) {
      setNotice({
        kind: "error",
        messages: ["This file is too large to import (the limit is 20 MB)."],
      });
      return;
    }
    try {
      const file = { text: await picked.text(), name: picked.name };
      if (svgNeedsDpi(file.text)) {
        setNotice(null);
        setPending(file);
      } else {
        add(file, DEFAULT_SVG_DPI);
      }
    } catch (error) {
      fail(error);
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
        <ul className="grid gap-0.5">
          {shapes.map((shape) => (
            <li key={shape.id} className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{shape.name || "Unnamed shape"}</span>
              {shape.layer && (
                <span className="ml-auto shrink-0 truncate text-muted-foreground">
                  {shape.layer}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
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
