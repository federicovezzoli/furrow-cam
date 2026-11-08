"use client";

import type { LonLat } from "@furrow/cam-core";
import { AttributionControl, Map as MapLibre, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawEllipseMode,
  TerraDrawFreehandMode,
  TerraDrawRectangleMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { ELEVATION_ATTRIBUTION, MAP_STYLE_URL } from "../lib/terrain-services";
import type { AreaShape } from "./terrain-dialog";

// MapLibre looks for its worker beside its own file, which a bundler moves; this points it there.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

/** The area's outline colour, readable on the map in both themes. */
const STROKE = "#e11d48";

/**
 * The map the user draws the terrain's area on (PRD-0014 T1, T3): MapLibre
 * with OpenFreeMap's style, and terra-draw for the shapes (ADR-0076). A new
 * shape replaces the last; `onArea` hears its ring (longitude and latitude,
 * not repeating the first point). Loaded in a chunk of its own, only when the
 * dialog opens. `onError` hears that the map couldn't load.
 */
export default function TerrainMap({
  shape,
  onArea,
  onError,
}: {
  shape: AreaShape;
  onArea: (ring: LonLat[]) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const draw = useRef<TerraDraw | null>(null);
  const callbacks = useRef({ onArea, onError });
  callbacks.current = { onArea, onError };
  const initialShape = useRef(shape);

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
          new TerraDrawFreehandMode({ styles: style, drawInteraction }),
        ],
      });
      terra.start();
      terra.setMode(initialShape.current);
      terra.on("finish", (id) => {
        const feature = terra.getSnapshotFeature(id);
        if (feature?.geometry.type !== "Polygon") return;
        // One area at a time: the new shape replaces the others.
        const others = terra.getSnapshot().filter((f) => f.id !== id && f.id !== undefined);
        if (others.length > 0) terra.removeFeatures(others.map((f) => f.id as string));
        const ring = feature.geometry.coordinates[0]?.slice(0, -1) ?? [];
        callbacks.current.onArea(ring.map(([lon, lat]) => [lon, lat] as LonLat));
      });
      draw.current = terra;
    });
    return () => {
      draw.current?.stop();
      draw.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (draw.current?.enabled) draw.current.setMode(shape);
    initialShape.current = shape;
  }, [shape]);

  return <div ref={container} className="size-full" data-demo="terrain-map" />;
}
