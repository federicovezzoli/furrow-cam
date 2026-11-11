"use client";

import {
  DEFAULT_STL_LIMITS,
  formatQuantity,
  type LonLat,
  planTerrain,
  type StlLimits,
  TERRAIN_BASE,
  TERRAIN_EXAGGERATION,
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
import { downloadFile } from "@furrow/ui/lib/download";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleIcon,
  DownloadIcon,
  LassoIcon,
  MountainIcon,
  RectangleHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import type * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { GeneratedTerrain } from "../lib/mesh-worker-protocol";
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
import { canImportModel } from "../stores/geometry-actions";
import { RibbonButton } from "./ribbon";
import { TerrainSearch } from "./terrain-search";

// MapLibre and terra-draw are about 1.5 MB: loaded only when the dialog opens (ADR-0076).
const TerrainMap = lazy(() => import("./terrain-map"));
const TerrainPreview = lazy(() => import("./terrain-preview"));

/** The area's shapes (PRD-0014 T3); with none picked, the map is browsed. */
export const AREA_SHAPES = ["rectangle", "square", "circle", "ellipse", "freehand"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

const SHAPE_ICONS: Record<AreaShape, React.ReactNode> = {
  rectangle: <RectangleHorizontalIcon />,
  square: <SquareIcon />,
  circle: <CircleIcon />,
  ellipse: <CircleIcon className="scale-y-[0.7]" />,
  freehand: <LassoIcon />,
};

/**
 * The preview's terrain (PRD-0014 T4): about 220 cells across, a tenth of the
 * model's triangles. Detailed enough to judge; its normals, worked out on the
 * main thread, take about 150 ms on a recent laptop.
 */
const PREVIEW_LIMITS: StlLimits = { maxBytes: Infinity, maxTriangles: 100_000 };
/** How long settings stay unchanged before the preview is made again. */
const PREVIEW_DELAY = 300;

/**
 * Opens *Terrain from a map* (PRD-0014), from the empty project's import card
 * or the ribbon (`inRibbon`). Where the terrain can't become the project's
 * model (a server that can't store meshes, a project that has its model),
 * it can still be downloaded (T8).
 */
export function TerrainButton({ inRibbon = false }: { inRibbon?: boolean }) {
  const t = useTranslations("Terrain");
  const [open, setOpen] = useState(false);
  const dialog = open && <TerrainDialog onClose={() => setOpen(false)} />;
  if (inRibbon)
    return (
      <>
        <RibbonButton
          icon={<MountainIcon />}
          label={t("ribbon")}
          aria-label={t("title")}
          data-demo="ribbon-terrain"
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

/**
 * The coarse terrain of `ring` with `settings`, made again once they stop
 * changing: the 3D preview, its size and its height range, with the
 * settings it was made with (the last one stays shown while the next is
 * made). `null` while the first is made, or with no area.
 */
function usePreview(ring: LonLat[] | null, settings: TerrainSettings | null) {
  const [preview, setPreview] = useState<
    | { terrain: GeneratedTerrain; settings: TerrainSettings }
    | { error: Translatable; settings: TerrainSettings }
    | null
  >(null);
  useEffect(() => {
    if (!ring || !settings) return setPreview(null);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      generateTerrain(ring, settings, PREVIEW_LIMITS, { signal: abort.signal }).then(
        (terrain) => {
          if (!abort.signal.aborted) setPreview({ terrain, settings });
        },
        (error) => {
          if (abort.signal.aborted) return;
          setPreview({
            settings,
            error:
              error instanceof MeshImportError
                ? error.detail
                : { code: "workspace.terrainUnavailable" },
          });
        },
      );
    }, PREVIEW_DELAY);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [ring, settings]);
  return preview;
}

function TerrainDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Terrain");
  const format = useFormatMessage();
  const host = useWorkspaceHost();
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const stock = useDocumentStore((s) => s.document.stock);
  const storable = host.limits.meshes;
  const hasModel = useDocumentStore((s) => !canImportModel(s.document));
  // A download stores nothing, so without the server's limits it takes the default ones.
  const limits = storable ?? DEFAULT_STL_LIMITS;
  const units = useDocumentStore((s) => s.document.units);

  /** First the area on the map, then the model made from it (PRD-0014 T3, T4). */
  const [step, setStep] = useState<"area" | "model">("area");
  const [mapFailed, setMapFailed] = useState(false);
  /** The shape being drawn, or `null` while the map is browsed. */
  const [shape, setShape] = useState<AreaShape | null>(null);
  const [ring, setRing] = useState<LonLat[] | null>(null);
  /** The place last picked in the search, which names the model, and where the map went. */
  const [place, setPlace] = useState<{ name: string | null; view: PlaceView } | null>(null);
  const [side, setSide] = useState<number | null>(null);
  const [exaggeration, setExaggeration] = useState(TERRAIN_EXAGGERATION.initial);
  const [base, setBase] = useState(TERRAIN_BASE.initial);
  /** Tiles fetched so far, then `saving` while the model is stored in the project. */
  const [progress, setProgress] = useState<{ done: number; total: number } | "saving" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<Translatable | null>(null);

  const planned = usePlan(ring, limits);
  const plan = planned && "plan" in planned ? planned.plan : null;
  const longestSide = side ?? (plan ? fittingSide(stock, plan.span) : null);
  const settings = useMemo(
    () => (longestSide ? { longestSide, exaggeration, base } : null),
    [longestSide, exaggeration, base],
  );
  const preview = usePreview(step === "model" ? ring : null, settings);
  const shown = preview && "terrain" in preview ? preview.terrain : null;
  // The preview on screen was made with other settings: a new one is on its way.
  const stale = preview !== null && preview.settings !== settings;
  useEffect(() => () => abort.current?.abort(), []);
  // The desktop app lets the services through only while the dialog is open (ADR-0076), and
  // the map waits for that, or its first requests could be refused.
  const [servicesOpen, setServicesOpen] = useState(!host.terrainServices);
  useEffect(() => {
    let open = true;
    void Promise.resolve(host.terrainServices?.(true)).then(() => {
      if (open) setServicesOpen(true);
    });
    return () => {
      open = false;
      void host.terrainServices?.(false);
    };
  }, [host]);

  const length = (mm: number) => formatQuantity(mm, "length", units);
  const lengthUnit = unitLabel("length", units);
  const area =
    plan && t("area", { width: tenths(plan.span[0] / 1000), depth: tenths(plan.span[1] / 1000) });
  // What the preview on screen was made with, so its lines agree with each other.
  const made = preview?.settings;
  const summary =
    plan && made && shown
      ? [
          area,
          t("size", {
            // The coarse preview smooths the peaks a little: its height is an estimate.
            size: `${length(shown.size[0])} × ${length(shown.size[1])} × ≈${length(shown.size[2])}`,
            unit: lengthUnit,
          }),
          t("heights", { low: Math.round(shown.heights[0]), high: Math.round(shown.heights[1]) }),
          t("detail", {
            metres: tenths(plan.cellMetres),
            mm: length((plan.cellMetres * made.longestSide) / Math.max(...plan.span)),
            unit: lengthUnit,
          }),
        ]
      : [];

  /** Makes the terrain at full detail and adds it to the project, or with `download` saves it as an STL file (T8). */
  async function generate(download = false) {
    if (!ring || !settings) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const terrain = await generateTerrain(ring, settings, limits, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // Cancelled as the worker finished: nothing is added.
      if (controller.signal.aborted) return;
      // Named after the place picked only if the area was drawn there.
      const name = fileNameFor(areaName(place, ring) ?? "") || t("defaultName");
      if (download) {
        // A view on the worker's buffer, not a copy.
        downloadFile(new Uint8Array(terrain.stl), `${name}.stl`, "model/stl");
        return;
      }
      setProgress("saving");
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
          <DialogDescription>
            {step === "area" ? t("description") : t("modelDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="grid gap-1.5">
            <div className="relative h-[60dvh] min-h-72 overflow-hidden rounded-md border">
              {/* The map stays while the model is shown, so going back finds it as it was. */}
              <div className={cn("size-full", step !== "area" && "hidden")}>
                {mapFailed ? (
                  <p className="p-4 text-muted-foreground" role="alert">
                    {t("mapUnavailable")}
                  </p>
                ) : (
                  servicesOpen && (
                    <Suspense
                      fallback={<p className="p-4 text-muted-foreground">{t("loading")}</p>}
                    >
                      <TerrainMap
                        shape={shape}
                        ring={ring}
                        view={place?.view ?? null}
                        onArea={(next, moved) => {
                          setRing(next);
                          // A moved area is as large as before: the size typed for it stays.
                          if (!moved) setSide(null);
                          setError(null);
                          // Drawn or moved: back to browsing the map.
                          setShape(null);
                        }}
                        onError={() => setMapFailed(true)}
                      />
                    </Suspense>
                  )
                )}
              </div>
              {step === "model" && (
                <div className="size-full" data-demo="terrain-preview">
                  {shown && (
                    <Suspense fallback={null}>
                      <TerrainPreview
                        stl={shown.stl}
                        size={shown.size}
                        // From the mesh on screen, so the camera fits the model it shows.
                        fitKey={`${ring?.join()}|${Math.round(Math.max(shown.size[0], shown.size[1]))}`}
                        current={!stale}
                      />
                    </Suspense>
                  )}
                  {!preview && (
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
              )}
            </div>
          </div>
          {step === "area" ? (
            <div className="grid content-start gap-3 text-ui">
              <TerrainSearch onPick={setPlace} />
              <div className="grid gap-1.5">
                <fieldset className="grid grid-cols-3 gap-1.5">
                  <legend className="mb-1.5 font-medium">{t("shape")}</legend>
                  {AREA_SHAPES.map((option) => (
                    <Button
                      key={option}
                      aria-pressed={shape === option}
                      variant={shape === option ? "default" : "outline"}
                      size="compact"
                      title={t(`tools.${option}`)}
                      aria-label={t(`tools.${option}`)}
                      data-demo={`terrain-tool-${option}`}
                      className="flex-col gap-0.5 py-1.5 text-[0.625rem] h-auto"
                      // Pressed again, back to browsing the map.
                      onClick={() => setShape(shape === option ? null : option)}
                    >
                      {SHAPE_ICONS[option]}
                      {t(`tools.${option}`)}
                    </Button>
                  ))}
                </fieldset>
                <p className="text-muted-foreground">{t("drawHint")}</p>
              </div>
              <div className="grid gap-0.5 text-muted-foreground" aria-live="polite">
                {!ring && <p>{t("noArea")}</p>}
                {planned && "error" in planned && (
                  <p className="text-destructive">{format(planned.error)}</p>
                )}
                {area && <p data-demo="terrain-area">{area}</p>}
              </div>
            </div>
          ) : (
            <div className="grid content-start gap-3 text-ui">
              <NumberField
                id="terrain-side"
                label={t("longestSide")}
                layout="inline"
                quantity="length"
                units={units}
                min={1}
                // A model added is placed at this size, so no larger than the stock less its
                // border; one that can only be downloaded has nothing to do with the stock.
                max={plan && storable && !hasModel ? fittingSide(stock, plan.span) : undefined}
                value={longestSide}
                disabled={generating}
                onValueChange={setSide}
              />
              <NumberField
                id="terrain-exaggeration"
                label={t("exaggeration")}
                layout="inline"
                quantity="number"
                suffix="×"
                min={TERRAIN_EXAGGERATION.min}
                max={TERRAIN_EXAGGERATION.max}
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
                min={TERRAIN_BASE.min}
                value={base}
                disabled={generating}
                onValueChange={setBase}
              />
              <div className="grid gap-0.5 text-muted-foreground" aria-live="polite">
                {summary.length > 0 ? (
                  summary.map((line) => <p key={line}>{line}</p>)
                ) : (
                  <p>{area}</p>
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
          )}
        </div>
        <DialogFooter>
          {step === "model" && (
            <Button
              variant="outline"
              className="sm:mr-auto"
              disabled={generating}
              onClick={() => setStep("area")}
            >
              <ArrowLeftIcon />
              {t("back")}
            </Button>
          )}
          <Button
            variant="outline"
            // Once the model is being stored, it can't be taken back.
            disabled={progress === "saving"}
            onClick={generating ? () => abort.current?.abort() : onClose}
          >
            {t("cancel")}
          </Button>
          {step === "area" ? (
            <Button
              disabled={!plan || mapFailed}
              data-demo="terrain-next"
              onClick={() => setStep("model")}
            >
              {t("next")}
              <ArrowRightIcon />
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={!plan || generating}
                onClick={() => void generate(true)}
              >
                <DownloadIcon />
                {t("download")}
              </Button>
              <Button
                disabled={!plan || generating || !storable || hasModel}
                data-demo="terrain-generate"
                onClick={() => void generate()}
              >
                {t("generate")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
