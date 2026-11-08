"use client";

import {
  formatQuantity,
  type LonLat,
  planTerrain,
  type StlLimits,
  type TerrainPlan,
  type TerrainSettings,
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
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { MountainIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { MeshImportError } from "../lib/model-import";
import { fittingSide } from "../lib/model-size";
import { areaName, fileNameFor, type PlaceView } from "../lib/place-search";
import { generateTerrain, importTerrain } from "../lib/terrain-import";
import { MAX_ELEVATION_ZOOM } from "../lib/terrain-services";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { canImportModel, ONE_MODEL } from "../stores/geometry-actions";
import { STL_IMPORT_OFF } from "./model-import-button";
import { RibbonButton } from "./ribbon";
import { TerrainSearch } from "./terrain-search";

// MapLibre and terra-draw are about 1.5 MB: loaded only when the dialog opens (ADR-0076).
const TerrainMap = lazy(() => import("./terrain-map"));

export const AREA_SHAPES = ["rectangle", "circle", "ellipse", "freehand"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

const EXAGGERATION = { min: 1, max: 10, initial: 1.5 };
const BASE = { min: 1, initial: 3 };
/** Enough cells to read an area's height range in a few small tiles, before generating. */
const PREVIEW_LIMITS: StlLimits = { maxBytes: Infinity, maxTriangles: 20_000 };

/** The notice of the services the map contacts has been read on this device (PRD-0014 T9). */
const NOTICE_KEY = "furrow:terrain-services";
function noticeRead(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}
function markNoticeRead() {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // Without storage the notice shows again next time.
  }
}

/**
 * Opens *Terrain from a map* (PRD-0014), from the empty project's import card
 * or the ribbon (`inRibbon`), when the project has no model yet and the
 * server can store meshes.
 */
export function TerrainButton({ inRibbon = false }: { inRibbon?: boolean }) {
  const t = useTranslations("Terrain");
  const format = useFormatMessage();
  const limits = useWorkspaceHost().limits.meshes;
  const allowed = useDocumentStore((s) => canImportModel(s.document));
  const [open, setOpen] = useState(false);
  const dialog = limits && open && <TerrainDialog limits={limits} onClose={() => setOpen(false)} />;
  if (inRibbon)
    return (
      <>
        <RibbonButton
          icon={<MountainIcon />}
          label={t("ribbon")}
          aria-label={t("title")}
          data-demo="ribbon-terrain"
          hint={t("hint")}
          disabledReason={
            !limits ? format(STL_IMPORT_OFF) : allowed ? undefined : format(ONE_MODEL)
          }
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
        disabled={!limits}
        title={limits ? undefined : format(STL_IMPORT_OFF)}
        data-demo="import-terrain"
        onClick={() => setOpen(true)}
        className="justify-self-start"
      >
        <MountainIcon />
        {t("open")}
      </Button>
      {dialog}
    </>
  );
}

/** What the area gives, before generating: the plan, or why it can't be made. */
function usePlan(ring: LonLat[] | null, limits: StlLimits) {
  return useMemo((): { plan: TerrainPlan } | { error: Translatable } | null => {
    if (!ring) return null;
    try {
      return { plan: planTerrain(ring, limits, MAX_ELEVATION_ZOOM) };
    } catch (error) {
      if (error instanceof MessageError) return { error: error.detail };
      throw error;
    }
  }, [ring, limits]);
}

/** `value` rounded to a tenth, for ICU to format in the user's language. */
const tenths = (value: number) => Math.round(value * 10) / 10;

/** The area's lowest and highest heights in metres, from a coarse terrain made in the background. */
function useHeightRange(ring: LonLat[] | null, valid: boolean) {
  const [range, setRange] = useState<[number, number] | null>(null);
  useEffect(() => {
    setRange(null);
    if (!ring || !valid) return;
    const abort = new AbortController();
    const settings = { longestSide: 100, exaggeration: 1, base: 1 };
    generateTerrain(ring, settings, PREVIEW_LIMITS, { signal: abort.signal }).then(
      (terrain) => setRange(terrain.heights),
      // Generating says why, if it fails too.
      () => {},
    );
    return () => abort.abort();
  }, [ring, valid]);
  return range;
}

function TerrainDialog({ limits, onClose }: { limits: StlLimits; onClose: () => void }) {
  const t = useTranslations("Terrain");
  const format = useFormatMessage();
  const host = useWorkspaceHost();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const stock = useDocumentStore((s) => s.document.stock);
  const units = useDocumentStore((s) => s.document.units);

  const [notice, setNotice] = useState(noticeRead);
  const [mapFailed, setMapFailed] = useState(false);
  const [shape, setShape] = useState<AreaShape>("rectangle");
  const [ring, setRing] = useState<LonLat[] | null>(null);
  /** The place last picked in the search, which names the model, and where the map went. */
  const [place, setPlace] = useState<{ name: string | null; view: PlaceView } | null>(null);
  const [side, setSide] = useState<number | null>(null);
  const [exaggeration, setExaggeration] = useState(EXAGGERATION.initial);
  const [base, setBase] = useState(BASE.initial);
  /** Tiles fetched so far, then `saving` while the model is stored in the project. */
  const [progress, setProgress] = useState<{ done: number; total: number } | "saving" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<Translatable | null>(null);

  const planned = usePlan(ring, limits);
  const plan = planned && "plan" in planned ? planned.plan : null;
  const range = useHeightRange(ring, plan !== null);
  useEffect(() => () => abort.current?.abort(), []);

  const longestSide = side ?? (plan ? fittingSide(stock, plan.span) : null);
  const length = (mm: number) => formatQuantity(mm, "length", units);
  const lengthUnit = unitLabel("length", units);

  let summary: string[] = [];
  if (plan && longestSide) {
    const scale = longestSide / Math.max(...plan.span);
    // From the coarse preview, which smooths the peaks a little: shown as an estimate.
    const height = range ? (range[1] - range[0]) * scale * exaggeration + base : null;
    const size = [plan.span[0] * scale, plan.span[1] * scale].map(length).join(" × ");
    summary = [
      t("area", {
        width: tenths(plan.span[0] / 1000),
        depth: tenths(plan.span[1] / 1000),
      }),
      t("size", {
        size: height === null ? `${size} × …` : `${size} × ≈${length(height)}`,
        unit: lengthUnit,
      }),
      range
        ? t("heights", { low: Math.round(range[0]), high: Math.round(range[1]) })
        : t("heightsLoading"),
      t("detail", {
        metres: tenths(plan.cellMetres),
        mm: length(plan.cellMetres * scale),
        unit: lengthUnit,
      }),
    ];
  }

  async function generate() {
    if (!ring || !longestSide) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress({ done: 0, total: 0 });
    const settings: TerrainSettings = { longestSide, exaggeration, base };
    try {
      const terrain = await generateTerrain(ring, settings, limits, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // Cancelled as the worker finished: nothing is added.
      if (controller.signal.aborted) return;
      setProgress("saving");
      // Named after the place picked only if the area was drawn there.
      const name = fileNameFor(areaName(place, ring) ?? "") || t("defaultName");
      const failed = await importTerrain(terrain, name, {
        meshes: host.meshes,
        document,
        workspace,
      });
      if (failed) setError(failed);
      else onClose();
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof MeshImportError
          ? caught.detail
          : { code: "workspace.terrainUnavailable" },
      );
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  const generating = progress !== null;
  return (
    <Dialog open onOpenChange={(next) => !next && progress !== "saving" && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {!notice ? (
          <div className="grid gap-3">
            <p>{t("notice")}</p>
            <Button
              className="justify-self-start"
              onClick={() => {
                markNoticeRead();
                setNotice(true);
              }}
            >
              {t("showMap")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="relative h-[60dvh] min-h-72 overflow-hidden rounded-md border">
              {mapFailed ? (
                <p className="p-4 text-muted-foreground" role="alert">
                  {t("mapUnavailable")}
                </p>
              ) : (
                <Suspense fallback={<p className="p-4 text-muted-foreground">{t("loading")}</p>}>
                  <TerrainMap
                    shape={shape}
                    view={place?.view ?? null}
                    onArea={(next) => {
                      // A new area stops a generation of the last one, unless it is being stored.
                      if (progress !== "saving") abort.current?.abort();
                      setRing(next);
                      setSide(null);
                      setError(null);
                    }}
                    onError={() => setMapFailed(true)}
                  />
                </Suspense>
              )}
            </div>
            <div className="grid content-start gap-3 text-ui">
              <TerrainSearch onPick={setPlace} />
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 font-medium">{t("shape")}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {AREA_SHAPES.map((option) => (
                    <Button
                      key={option}
                      variant="outline"
                      size="compact"
                      aria-pressed={shape === option}
                      className={cn(shape === option && "border-primary bg-accent")}
                      onClick={() => setShape(option)}
                    >
                      {t(`shapes.${option}`)}
                    </Button>
                  ))}
                </div>
                <p className="text-muted-foreground">{t("drawHint")}</p>
              </fieldset>
              <NumberField
                id="terrain-side"
                label={t("longestSide")}
                layout="inline"
                quantity="length"
                units={units}
                min={1}
                // The model is placed at this size: no larger than the stock less its border.
                max={plan ? fittingSide(stock, plan.span) : undefined}
                value={longestSide}
                disabled={!plan || generating}
                onValueChange={setSide}
              />
              <NumberField
                id="terrain-exaggeration"
                label={t("exaggeration")}
                layout="inline"
                quantity="number"
                suffix="×"
                min={EXAGGERATION.min}
                max={EXAGGERATION.max}
                step={0.5}
                value={exaggeration}
                disabled={generating}
                onValueChange={setExaggeration}
              />
              <NumberField
                id="terrain-base"
                label={t("base")}
                layout="inline"
                quantity="length"
                units={units}
                min={BASE.min}
                value={base}
                disabled={generating}
                onValueChange={setBase}
              />
              <div className="grid gap-0.5 text-muted-foreground" aria-live="polite">
                {!ring && <p>{t("noArea")}</p>}
                {planned && "error" in planned && (
                  <p className="text-destructive">{format(planned.error)}</p>
                )}
                {summary.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              {error && (
                <p className="text-destructive" role="alert">
                  {format(error)}
                </p>
              )}
              {progress && (
                <p aria-live="polite">
                  {progress === "saving"
                    ? t("saving")
                    : progress.total === 0
                      ? t("fetchingStart")
                      : progress.done < progress.total
                        ? t("fetching", progress)
                        : t("building")}
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            // Once the model is being stored, it can't be taken back.
            disabled={progress === "saving"}
            onClick={generating ? () => abort.current?.abort() : onClose}
          >
            {t("cancel")}
          </Button>
          {notice && (
            <Button disabled={!plan || generating || mapFailed} onClick={() => void generate()}>
              {t("generate")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
