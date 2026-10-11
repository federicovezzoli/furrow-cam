import type { Machine, Tool } from "@furrow/document";

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
  stepOver: 40,
  notes: null,
  color: "#2563eb",
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

export const shapeoko: Machine = {
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
  programStart: null,
  programEnd: null,
  operationStart: null,
  toolChange: null,
};

/** Manual spindle (a trim router with a speed dial) and a custom tool change. */
export const lowRider: Machine = {
  name: "LowRider v4 (Makita RT0701C)",
  workAreaX: 1220,
  workAreaY: 2440,
  workAreaZ: 85,
  maxFeedXY: 4800,
  maxFeedZ: 900,
  spindleRpmMin: null,
  spindleRpmMax: null,
  safeZ: 8,
  postProcessor: "grbl",
  programStart: null,
  programEnd: null,
  operationStart: null,
  toolChange: "G0 Z20\nM0 (Switch off the router and change the bit)",
};
