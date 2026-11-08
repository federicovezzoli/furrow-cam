"use client";

import type { LonLat } from "@furrow/cam-core";
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MapLibre,
  type MapMouseEvent,
  type MapTouchEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawEllipseMode,
  TerraDrawFreehandMode,
  TerraDrawRectangleMode,
  ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { PlaceView } from "../lib/place-search";
import { ELEVATION_ATTRIBUTION, MAP_STYLE_URL } from "../lib/terrain-services";
import { moveRing, squareRing } from "../lib/terrain-square";
import type { AreaShape } from "./terrain-dialog";

// MapLibre looks for its worker beside its own file, which a bundler moves; this points it there.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

/** How far the pointer must move, in pixels, for a press to draw or move rather than click. */
const CLICK_PIXELS = 4;

type Point2 = [x: number, y: number];

/** The area's outline colour, readable on the map in both themes. */
const STROKE = "#e11d48";

/** A closed polygon of `ring`, as GeoJSON wants it. */
const polygon = (ring: LonLat[]) => ({
  type: "Polygon" as const,
  coordinates: [[...ring, ring[0] as LonLat].map(([lon, lat]) => [lon, lat])],
});

/**
 * The map the user draws the terrain's area on (PRD-0014 T1, T3): MapLibre
 * with OpenFreeMap's style, and terra-draw for the shapes (ADR-0076). With no
 * `shape` the map is dragged, and so is the area drawn, by pressing on it;
 * with a shape, dragging draws it (a square is drawn here, terra-draw has
 * none). The area, `ring` (longitude and latitude, not repeating the first
 * point), is shown here whatever drew it; `onArea` hears a new one, or a
 * moved one with `moved`.
 * Loaded in a chunk of its own, only when the dialog opens. `onError` hears
 * that the map couldn't load. The map moves to `view` whenever it changes (a
 * place found, PRD-0014 T2).
 */
export default function TerrainMap({
  shape,
  ring,
  view,
  onArea,
  onError,
}: {
  shape: AreaShape | null;
  ring: LonLat[] | null;
  view: PlaceView | null;
  onArea: (ring: LonLat[], moved?: boolean) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const draw = useRef<TerraDraw | null>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const setShapeRef = useRef<(shape: AreaShape | null) => void>(() => {});
  const callbacks = useRef({ onArea, onError });
  callbacks.current = { onArea, onError };
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const ringRef = useRef(ring);
  ringRef.current = ring;
  /** Shows `ring`, or nothing, as the area. */
  const showRef = useRef<(ring: LonLat[] | null) => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibre({
      container: container.current,
      style: MAP_STYLE_URL,
      center: [10, 30],
      zoom: 1.5,
      attributionControl: false,
      // One world: on a repeated copy longitudes pass 180°, which terra-draw refuses.
      renderWorldCopies: false,
      // Rotating would turn the drawn rectangle on the ground; the model's sides follow north.
      dragRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: ELEVATION_ATTRIBUTION }),
    );
    map.addControl(new NavigationControl({ showCompass: false }));
    let ready = false;
    let failed = false;
    map.on("error", () => {
      // Only a map that never loaded is reported; a missing tile later isn't worth a message.
      if (!ready && !failed) {
        failed = true;
        callbacks.current.onError();
      }
    });
    map.on("load", () => {
      ready = true;
      const style = {
        fillColor: STROKE,
        outlineColor: STROKE,
        fillOpacity: 0.15,
        outlineWidth: 2,
      } as const;
      // Dragging or clicking twice both draw a shape.
      const drawInteraction = "click-move-or-drag";
      const terra = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawRectangleMode({ styles: style, drawInteraction }),
          new TerraDrawCircleMode({ styles: style, drawInteraction }),
          new TerraDrawEllipseMode({ styles: style, drawInteraction }),
          new TerraDrawFreehandMode({
            styles: style,
            drawInteraction,
            // A loop that crosses itself has no clear inside; it isn't kept.
            validation: (feature) => ValidateNotSelfIntersecting(feature),
          }),
        ],
      });
      terra.start();
      terra.on("finish", (id) => {
        const feature = terra.getSnapshotFeature(id);
        if (feature?.geometry.type !== "Polygon") return;
        // The area is shown here from now on, so it can be moved like the square.
        terra.clear();
        const ring = feature.geometry.coordinates[0]?.slice(0, -1) ?? [];
        callbacks.current.onArea(ring.map(([lon, lat]) => [lon, lat] as LonLat));
      });
      draw.current = terra;
      setShape(shapeRef.current);

      // The area, whatever drew it, and the square as it is dragged out.
      map.addSource("area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "area-fill",
        type: "fill",
        source: "area",
        paint: { "fill-color": STROKE, "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "area-line",
        type: "line",
        source: "area",
        paint: { "line-color": STROKE, "line-width": 2 },
      });
      const area = map.getSource("area") as GeoJSONSource;
      const show = (ring: LonLat[] | null) =>
        area.setData(
          ring
            ? { type: "Feature", geometry: polygon(ring), properties: {} }
            : { type: "FeatureCollection", features: [] },
        );
      showRef.current = show;
      show(ringRef.current);
      // Pressing on the area grabs it: a cursor says so.
      map.on("mouseenter", "area-fill", () => {
        if (!shapeRef.current) map.getCanvas().style.cursor = "move";
      });
      map.on("mouseleave", "area-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      /** A square being dragged out, or the area being moved. */
      let dragging: "square" | "move" | null = null;
      let start: LonLat | null = null;
      /** Where the drag last was on the map: a release outside it ends the square there. */
      let last: LonLat | null = null;
      /** The same two places in pixels, to tell a drag from a click that jittered. */
      let startPixel: Point2 = [0, 0];
      let lastPixel: Point2 = [0, 0];
      const at = ({ lngLat }: MapMouseEvent | MapTouchEvent): LonLat => [lngLat.lng, lngLat.lat];
      const pixel = ({ point }: MapMouseEvent | MapTouchEvent): Point2 => [point.x, point.y];
      /** Where the drag would put the area. */
      const result = (to: LonLat) =>
        dragging === "square"
          ? squareRing(start as LonLat, to)
          : moveRing(ringRef.current ?? [], start as LonLat, to);
      const begin = (event: MapMouseEvent | MapTouchEvent) => {
        const over =
          !shapeRef.current &&
          ringRef.current !== null &&
          map.queryRenderedFeatures(event.point, { layers: ["area-fill"] }).length > 0;
        dragging = shapeRef.current === "square" ? "square" : over ? "move" : null;
        if (!dragging) return;
        // The map isn't dragged along.
        event.preventDefault();
        start = last = at(event);
        startPixel = lastPixel = pixel(event);
        // The map hears no release past its edge; the window does.
        window.addEventListener("mouseup", end, { once: true });
      };
      const grow = (event: MapMouseEvent | MapTouchEvent) => {
        if (!start) return;
        last = at(event);
        lastPixel = pixel(event);
        show(result(last));
      };
      const end = (event?: MapMouseEvent | MapTouchEvent | MouseEvent) => {
        if (!start || !last) return;
        const onMap = event && "lngLat" in event;
        const ring = result(onMap ? at(event) : last);
        const [x, y] = onMap ? pixel(event) : lastPixel;
        const dragged = dragging;
        start = null;
        dragging = null;
        // A click, even one that jittered a pixel or two, draws or moves nothing.
        if (Math.hypot(x - startPixel[0], y - startPixel[1]) < CLICK_PIXELS) {
          show(ringRef.current);
          return;
        }
        callbacks.current.onArea(ring, dragged === "move");
      };
      map.on("mousedown", begin);
      map.on("touchstart", begin);
      map.on("mousemove", grow);
      map.on("touchmove", grow);
      map.on("mouseup", end);
      map.on("touchend", end);
    });

    /** Drawing with terra-draw, the square drawn here, or, with no shape, dragging the map. */
    function setShape(next: AreaShape | null) {
      const terra = draw.current;
      if (!terra?.enabled) return;
      terra.setMode(next && next !== "square" ? next : "static");
      if (next) map.dragPan.disable();
      else map.dragPan.enable();
    }
    setShapeRef.current = setShape;
    return () => {
      draw.current?.stop();
      draw.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    setShapeRef.current(shape);
  }, [shape]);

  useEffect(() => {
    showRef.current(ring);
  }, [ring]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !view) return;
    if ("bounds" in view) map.fitBounds(view.bounds, { padding: 40, maxZoom: 16 });
    else map.jumpTo(view);
  }, [view]);

  return <div ref={container} className="size-full" data-demo="terrain-map" />;
}
