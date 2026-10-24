// Reference data for tests, here and in the packages that depend on this one
// (`@furrow/document/fixtures`). Not part of the app.
import type {
  Drawing,
  Machine,
  Model,
  ProjectDocument,
  ReliefFinishOperation,
  ReliefRoughOperation,
  Shape,
  Tool,
} from "./index";

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
  plungeAngle: 3,
  stepDown: 2,
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

export const ballEndMill: Tool = {
  ...endMill,
  name: "3 mm ball end mill",
  type: "ball_end_mill",
  diameter: 3,
  fluteLength: 12,
  stepDown: 1,
  color: "#9333ea",
};

export const drill: Tool = {
  ...endMill,
  name: "6 mm drill",
  type: "drill",
  diameter: 6,
  fluteLength: 30,
  cutDirection: null,
  spindleRpm: 12000,
  feedRate: 1000,
  plungeRate: 300,
  plungeAngle: 90,
  stepDown: 4,
  color: "#16a34a",
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
  spinUpDelay: 5,
  safeZ: 5,
  entryClearance: 1,
  postProcessor: "grbl",
  programStart: null,
  programEnd: null,
  operationStart: null,
  toolChange: null,
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
  spinUpDelay: 2,
  safeZ: 5,
  entryClearance: 1,
  postProcessor: "grbl",
  programStart: null,
  programEnd: null,
  operationStart: null,
  /** Manual spindle: stop and wait while the router is switched off and the bit changed. */
  toolChange: "G0 Z20\nM0 (Switch off the router and change the bit)",
};

export const SQUARE_ID = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
export const CIRCLE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const DRAWING_ID = "6e2d9b4a-1c3f-4a5e-8d7b-9f0a1b2c3d4e";
export const OPERATION_ID = "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a";

export const square: Shape = {
  id: SQUARE_ID,
  name: "Square",
  layer: "0",
  source: "part.dxf",
  drawingId: DRAWING_ID,
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
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

export const TEXT_ID = "2c7e5a1b-8d4f-4b3a-9e6c-1f0d2a3b4c5e";

/** A text item (ADR-0059): "I" in a 10 mm cap height, its stem's corner at `[10, 10]`. */
export const textItem: Drawing = {
  id: TEXT_ID,
  name: "I",
  border: 10,
  text: {
    text: "I",
    font: "sans",
    height: 10,
    align: "left",
    placement: { position: [10, 10], rotation: 0, mirrored: false },
  },
};

/** `textItem`'s outlines, its one shape. */
export const textShape: Shape = {
  id: "8b4d2f6a-3c1e-4a9b-8d7c-5e0f1a2b3c4d",
  name: "I",
  layer: "",
  drawingId: TEXT_ID,
  paths: [
    {
      start: [10, 10],
      segments: [
        { kind: "line", to: [12, 10] },
        { kind: "line", to: [12, 20] },
        { kind: "line", to: [10, 20] },
      ],
      closed: true,
    },
  ],
};

/** An imported STL relief (PRD-0005); its mesh is a project asset (ADR-0029). */
export const model: Model = {
  id: "5f0c2a8e-3b7d-4e19-9c6a-2d8f1b4e7a30",
  sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  fileName: "emblem.stl",
  size: 684,
  triangles: 12,
  bounds: { min: [-50, -40, 0], max: [50, 40, 12] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 12, position: [0, 0] },
  border: 10,
};

export const RELIEF_FINISH_ID = "7c1e4b2a-9d3f-4a6e-8b5c-2f0e1d9a8b7c";

/** A 3D finishing operation on `model` (#115). */
export const reliefFinish: ReliefFinishOperation = {
  id: RELIEF_FINISH_ID,
  type: "relief_finish",
  name: "Finish",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: ballEndMill,
  params: {
    modelId: model.id,
    strategy: { type: "parallel", angle: 0, direction: "zigzag" },
    stepOver: 10,
    stockToLeave: 0,
    rest: false,
  },
};

export const RELIEF_ROUGH_ID = "3a9d6e1f-2b4c-4d8e-9f7a-6c5b0e2d1a48";

/** A 3D roughing operation on `model` (#116). */
export const reliefRough: ReliefRoughOperation = {
  id: RELIEF_ROUGH_ID,
  type: "relief_rough",
  name: "Rough",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: endMill,
  params: {
    modelId: model.id,
    strategy: { type: "offset" },
    direction: "climb",
    stepOver: 40,
    stockToLeave: 0.5,
    boundary: { type: "model" },
    ramp: true,
    rest: false,
  },
};

export function fullDocument(): ProjectDocument {
  return {
    schemaVersion: 20,
    units: "in",
    stock: {
      width: 300,
      height: 200,
      thickness: 18,
      xyOrigin: { anchor: "center" },
      zOrigin: "machine_bed",
      touchOff: { x: 10, y: 10, diameter: 15, toolChange: null },
      twoSided: { flipAxis: "x", partingDepth: 9 },
    },
    machine,
    drawings: [{ id: DRAWING_ID, name: "part.dxf", border: 10 }],
    geometry: [square, circle],
    models: [],
    operations: [
      {
        id: OPERATION_ID,
        type: "profile",
        name: "Outside profile",
        enabled: true,
        stockSide: "top",
        targets: [
          { shapeId: SQUARE_ID, paths: null },
          { shapeId: CIRCLE_ID, paths: [0] },
        ],
        tool: endMill,
        params: {
          side: "outside",
          direction: "climb",
          depth: 18,
          allowance: 0.5,
          finishPass: true,
          leadIn: { radius: 3 },
          ramp: true,
          tabs: { width: 8, height: 3, positions: [[50, 0]] },
        },
      },
    ],
  };
}
