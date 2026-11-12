"use client";

import {
  DEFAULT_STL_LIMITS,
  formatQuantity,
  IMAGE_RELIEF,
  type ImageReliefSettings,
  unitLabel,
} from "@furrow/cam-core";
import { MessageError } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { downloadFile } from "@furrow/ui/lib/download";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { DownloadIcon, ImageIcon, UploadIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { PREVIEW_LIMITS, useMeshPreview } from "../hooks/use-mesh-preview";
import { generateRelief, type ReadImage, readImage } from "../lib/image-relief-import";
import { importGeneratedModel } from "../lib/model-import";
import { fittingSide } from "../lib/model-size";
import { fileNameFor } from "../lib/place-search";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { canImportModel } from "../stores/geometry-actions";
import { Checkbox } from "./checkbox";
import { RibbonButton } from "./ribbon";

const TerrainPreview = lazy(() => import("./terrain-preview"));

const UNREADABLE: Translatable = { code: "workspace.unreadableFile" };

/** The picked image, read once, the model's name, and which pick it was, to refit the view. */
type Picked = ReadImage & { name: string; key: number };

/**
 * Opens *Relief from image* (PRD-0015), from the empty project's import card
 * or the ribbon (`inRibbon`), beside *Terrain from a map*.
 */
export function ImageReliefButton({ inRibbon = false }: { inRibbon?: boolean }) {
  const t = useTranslations("ImageRelief");
  const [open, setOpen] = useState(false);
  const dialog = open && <ImageReliefDialog onClose={() => setOpen(false)} />;
  if (inRibbon)
    return (
      <>
        <RibbonButton
          icon={<ImageIcon />}
          label={t("ribbon")}
          aria-label={t("title")}
          hint={t("hint")}
          onClick={() => setOpen(true)}
        />
        {dialog}
      </>
    );
  return (
    <>
      <Button
        variant="outline"
        size="compact"
        onClick={() => setOpen(true)}
        className="justify-self-start"
      >
        <ImageIcon />
        {t("open")}
      </Button>
      {dialog}
    </>
  );
}

/** The preview's coarse relief of `image`, for `useMeshPreview`. */
const previewRelief = (image: ImageData, settings: ImageReliefSettings, signal: AbortSignal) =>
  generateRelief(image, settings, PREVIEW_LIMITS, { signal });

function ImageReliefDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("ImageRelief");
  const format = useFormatMessage();
  const host = useWorkspaceHost();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const stock = useDocumentStore((s) => s.document.stock);
  const units = useDocumentStore((s) => s.document.units);
  const storable = host.limits.meshes;
  const hasModel = useDocumentStore((s) => !canImportModel(s.document));
  // A download stores nothing, so without the server's limits it takes the default ones.
  const limits = storable ?? DEFAULT_STL_LIMITS;

  const input = useRef<HTMLInputElement>(null);
  const picks = useRef(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [relief, setRelief] = useState(IMAGE_RELIEF.relief.initial);
  const [base, setBase] = useState(IMAGE_RELIEF.base.initial);
  const [invert, setInvert] = useState(false);
  const [blur, setBlur] = useState(IMAGE_RELIEF.blur.initial);
  const [progress, setProgress] = useState<"building" | "saving" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<Translatable | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // By default as wide as fits inside the stock less the model border, as a terrain (PRD-0014 T4).
  const fitting = picked
    ? (fittingSide(stock, picked.size) * picked.size[0]) / Math.max(...picked.size)
    : null;
  const modelWidth = width ?? fitting;
  // The smoothing is in the picked image's pixels; the pixels kept may be fewer.
  const shrunk = picked ? picked.image.width / picked.size[0] : 1;
  const settings = useMemo(
    () => (modelWidth ? { width: modelWidth, relief, base, invert, blur: blur * shrunk } : null),
    [modelWidth, relief, base, invert, blur, shrunk],
  );
  const preview = useMeshPreview(picked?.image ?? null, settings, previewRelief, UNREADABLE);
  const shown = preview && "mesh" in preview ? preview.mesh : null;
  const stale = preview !== null && preview.settings !== settings;

  async function pick(file: File) {
    setError(null);
    try {
      const read = await readImage(file, limits);
      const name = fileNameFor(file.name.replace(/\.[^.]*$/, "")) || t("defaultName");
      setPicked({ ...read, name, key: ++picks.current });
    } catch (caught) {
      // The image shown before isn't the one picked: nothing is left to add by mistake.
      setPicked(null);
      setError(caught instanceof MessageError ? caught.detail : UNREADABLE);
    }
    setWidth(null);
  }

  /** Makes the relief at full detail and adds it to the project, or with `download` saves it as an STL file. */
  async function generate(download = false) {
    if (!picked || !settings) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress("building");
    try {
      const made = await generateRelief(picked.image, settings, limits, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (download) {
        downloadFile(new Uint8Array(made.stl), `${picked.name}.stl`, "model/stl");
        return;
      }
      setProgress("saving");
      const failed = await importGeneratedModel(
        made,
        picked.name,
        { meshes: host.meshes, document, workspace },
        "image",
      );
      if (failed) setError(failed);
      else onClose();
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof MessageError ? caught.detail : UNREADABLE);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  const length = (mm: number) => formatQuantity(mm, "length", units);
  const lengthUnit = unitLabel("length", units);
  const generating = progress !== null;
  return (
    <Dialog open onOpenChange={(next) => !next && progress !== "saving" && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="relative h-[60dvh] min-h-72 overflow-hidden rounded-md border">
            {shown && (
              <Suspense fallback={null}>
                <TerrainPreview
                  stl={shown.stl}
                  size={shown.size}
                  fitKey={`${picked?.key}|${Math.round(shown.size[0])}`}
                  current={!stale}
                  label={t("preview")}
                />
              </Suspense>
            )}
            {!picked && (
              <p className="absolute inset-0 grid place-items-center p-4 text-muted-foreground">
                {t("noImage")}
              </p>
            )}
            {picked && !preview && (
              <p className="absolute inset-0 grid place-items-center text-muted-foreground">
                {t("previewLoading")}
              </p>
            )}
            {preview && "error" in preview && (
              <p
                className="absolute inset-0 grid place-items-center p-4 text-destructive"
                role="alert"
              >
                {format(preview.error)}
              </p>
            )}
          </div>
          <div className="grid content-start gap-3 text-ui">
            <input
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void pick(file);
              }}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            />
            <Button
              variant="outline"
              size="compact"
              className="justify-self-start"
              disabled={generating}
              onClick={() => input.current?.click()}
            >
              <UploadIcon />
              {picked ? t("change") : t("pick")}
            </Button>
            <NumberField
              id="relief-width"
              label={t("width")}
              layout="inline"
              quantity="length"
              units={units}
              min={1}
              // Placed at this size, so no wider than fits the stock; a download has nothing to do with it.
              max={fitting && storable && !hasModel ? fitting : undefined}
              value={modelWidth}
              disabled={!picked || generating}
              onValueChange={setWidth}
            />
            <NumberField
              id="relief-height"
              label={t("relief")}
              layout="inline"
              quantity="length"
              units={units}
              min={IMAGE_RELIEF.relief.min}
              value={relief}
              disabled={generating}
              onValueChange={setRelief}
            />
            <NumberField
              id="relief-base"
              label={t("base")}
              layout="inline"
              quantity="length"
              units={units}
              min={IMAGE_RELIEF.base.min}
              value={base}
              disabled={generating}
              onValueChange={setBase}
            />
            <NumberField
              id="relief-blur"
              label={t("blur")}
              layout="inline"
              quantity="number"
              suffix="px"
              min={IMAGE_RELIEF.blur.min}
              max={IMAGE_RELIEF.blur.max}
              step={1}
              value={blur}
              disabled={generating}
              onValueChange={setBlur}
            />
            <Checkbox
              id="relief-invert"
              label={t("invert")}
              hint={t("invertHint")}
              checked={invert}
              disabled={generating}
              onChange={setInvert}
            />
            <div className="grid gap-0.5 text-muted-foreground" aria-live="polite">
              {picked && <p>{t("pixels", { width: picked.size[0], height: picked.size[1] })}</p>}
              {shown && (
                <p>
                  {t("size", {
                    // The coarse preview smooths the peaks a little: its height is an estimate.
                    size: `${length(shown.size[0])} × ${length(shown.size[1])} × ≈${length(shown.size[2])}`,
                    unit: lengthUnit,
                  })}
                </p>
              )}
              {stale && <p>{t("previewLoading")}</p>}
            </div>
            {(!storable || hasModel) && (
              <p className="text-muted-foreground">{storable ? t("hasModel") : t("storeOff")}</p>
            )}
            {error && (
              <p className="text-destructive" role="alert">
                {format(error)}
              </p>
            )}
            {progress && <p aria-live="polite">{t(progress)}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={progress === "saving"}
            onClick={generating ? () => abort.current?.abort() : onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={!settings || generating}
            onClick={() => void generate(true)}
          >
            <DownloadIcon />
            {t("download")}
          </Button>
          <Button
            disabled={!settings || generating || !storable || hasModel}
            onClick={() => void generate()}
          >
            {t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
