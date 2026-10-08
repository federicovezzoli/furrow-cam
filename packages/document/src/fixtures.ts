import type { Machine, ProjectDocument, Shape, Tool } from "./index";

export const endMill: Tool = {
  name: '1/4" 2-flute upcut',
  type: "flat_end_mill",
  diameter: 6.35,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  stepDown: 2,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

export const vBit: Tool = {
  ...endMill,
  name: "60° V-bit",
  type: "v_bit",
  cutDirection: null,
  vAngle: 60,
  tipDiameter: 0,
  color: "#d97706",
};

export const machine: Machine = {
  name: "Shapeoko 4 XL",
  workAreaX: 838,
  workAreaY: 432,
  workAreaZ: 95,
  maxFeedXY: 10000,
  maxFeedZ: 2500,
  spindleRpmMin: 10000,
  spindleRpmMax: 30000,
  safeZ: 5,
  postProcessor: "grbl",
};

/** V1 Engineering LowRider v4, full-sheet build, Makita RT0701C with a speed dial. */
export const lowRider: Machine = {
  name: "LowRider v4 (Makita RT0701C)",
  workAreaX: 1220,
  workAreaY: 2440,
  workAreaZ: 85,
  maxFeedXY: 4800,
  maxFeedZ: 900,
  spindleRpmMin: null,
  spindleRpmMax: null,
  safeZ: 5,
  postProcessor: "grbl",
};

export const SQUARE_ID = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
export const CIRCLE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const OPERATION_ID = "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a";

export const square: Shape = {
  id: SQUARE_ID,
  name: "Square",
  layer: "0",
  source: "part.dxf",
  paths: [
    {
      start: [0, 0],
      segments: [
        { kind: "line", to: [100, 0] },
        { kind: "line", to: [100, 100] },
        { kind: "cubic", c1: [60, 120], c2: [40, 80], to: [0, 100] },
      ],
      closed: true,
    },
  ],
};

export const circle: Shape = {
  id: CIRCLE_ID,
  name: "Hole",
  layer: "holes",
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

export function fullDocument(): ProjectDocument {
  return {
    schemaVersion: 1,
    units: "in",
    stock: { width: 300, height: 200, thickness: 18, xyOrigin: "center", zOrigin: "machine_bed" },
    machine,
    geometry: [square, circle],
    operations: [
      {
        id: OPERATION_ID,
        type: "profile",
        name: "Outside profile",
        enabled: true,
        shapeIds: [SQUARE_ID, CIRCLE_ID],
        tool: endMill,
        params: {},
      },
    ],
  };
}
