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
import { squareRing } from "../lib/terrain-square";
import type { AreaTool } from "./terrain-dialog";

// MapLibre looks for its worker beside its own file, which a bundler moves; this points it there.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

/** The area's outline colour, readable on the map in both themes. */
const STROKE = "#e11d48";

/** A closed polygon of `ring`, as GeoJSON wants it. */
const polygon = (ring: LonLat[]) => ({
  type: "Polygon" as const,
  coordinates: [[...ring, ring[0] as LonLat].map(([lon, lat]) => [lon, lat])],
});

/**
 * The map the user draws the terrain's area on (PRD-0014 T1, T3): MapLibre
 * with OpenFreeMap's style, and terra-draw for the shapes (ADR-0076). With
 * `tool` `move` the map is dragged; with a shape, dragging draws it (a square
 * is drawn here, terra-draw has none). A new shape replaces the last;
 * `onArea` hears its ring (longitude and latitude, not repeating the first
 * point). Loaded in a chunk of its own, only when the dialog opens. `onError`
 * hears that the map couldn't load. The map moves to `view` whenever it
 * changes (a place found, PRD-0014 T2).
 */
export default function TerrainMap({
  tool,
  view,
  onArea,
  onError,
}: {
  tool: AreaTool;
  view: PlaceView | null;
  onArea: (ring: LonLat[]) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const draw = useRef<TerraDraw | null>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const setToolRef = useRef<(tool: AreaTool) => void>(() => {});
  const callbacks = useRef({ onArea, onError });
  callbacks.current = { onArea, onError };
  const current = useRef({ tool });
  current.current = { tool };

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
      // Fine enough that the outline drawing stays within the 0.01 mm chord tolerance up to 300 mm across.
      const segments = 512;
      const terra = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawRectangleMode({ styles: style, drawInteraction }),
          new TerraDrawCircleMode({ styles: style, drawInteraction, segments }),
          new TerraDrawEllipseMode({ styles: style, drawInteraction, segments }),
          new TerraDrawFreehandMode({
            styles: style,
            drawInteraction,
            // A loop that crosses itself has no inside to cut out (T7); it isn't kept.
            validation: (feature) => ValidateNotSelfIntersecting(feature),
          }),
        ],
      });
      terra.start();
      terra.on("finish", (id) => {
        const feature = terra.getSnapshotFeature(id);
        if (feature?.geometry.type !== "Polygon") return;
        // One area at a time: the new shape replaces the others, the square too.
        (map.getSource("square") as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: [],
        });
        const others = terra.getSnapshot().filter((f) => f.id !== id && f.id !== undefined);
        if (others.length > 0) terra.removeFeatures(others.map((f) => f.id as string));
        const ring = feature.geometry.coordinates[0]?.slice(0, -1) ?? [];
        callbacks.current.onArea(ring.map(([lon, lat]) => [lon, lat] as LonLat));
      });
      draw.current = terra;
      setTool(current.current.tool);

      // The square: dragged from a corner and drawn here, as terra-draw has none.
      map.addSource("square", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "square-fill",
        type: "fill",
        source: "square",
        paint: { "fill-color": STROKE, "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "square-line",
        type: "line",
        source: "square",
        paint: { "line-color": STROKE, "line-width": 2 },
      });
      const preview = map.getSource("square") as GeoJSONSource;
      let start: LonLat | null = null;
      const at = ({ lngLat }: MapMouseEvent | MapTouchEvent): LonLat => [lngLat.lng, lngLat.lat];
      const begin = (event: MapMouseEvent | MapTouchEvent) => {
        if (current.current.tool !== "square") return;
        event.preventDefault();
        start = at(event);
      };
      const grow = (event: MapMouseEvent | MapTouchEvent) => {
        if (!start) return;
        preview.setData({
          type: "Feature",
          geometry: polygon(squareRing(start, at(event))),
          properties: {},
        });
      };
      const end = (event: MapMouseEvent | MapTouchEvent) => {
        if (!start) return;
        const ring = squareRing(start, at(event));
        start = null;
        // A click without a drag draws nothing.
        if (ring[0]?.[0] === ring[1]?.[0]) {
          preview.setData({ type: "FeatureCollection", features: [] });
          return;
        }
        // The square stays drawn here and replaces terra-draw's shape; it goes when that draws one.
        terra.clear();
        callbacks.current.onArea(ring);
      };
      map.on("mousedown", begin);
      map.on("touchstart", begin);
      map.on("mousemove", grow);
      map.on("touchmove", grow);
      map.on("mouseup", end);
      map.on("touchend", end);
    });

    /** Drawing with terra-draw, the square drawn here, or dragging the map. */
    function setTool(next: AreaTool) {
      const terra = draw.current;
      if (!terra?.enabled) return;
      const drawn = next !== "move" && next !== "square";
      terra.setMode(drawn ? next : "static");
      if (next === "move") map.dragPan.enable();
      else map.dragPan.disable();
    }
    setToolRef.current = setTool;
    return () => {
      draw.current?.stop();
      draw.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    setToolRef.current(tool);
  }, [tool]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !view) return;
    if ("bounds" in view) map.fitBounds(view.bounds, { padding: 40, maxZoom: 16 });
    else map.jumpTo(view);
  }, [view]);

  return <div ref={container} className="size-full" data-demo="terrain-map" />;
}
