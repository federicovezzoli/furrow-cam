// The projects of the G-code regression corpus (#149): each goes from its
// input file through the steps the workspace takes (import, alignment to the
// stock, operations) to a program checked into `programs/`.
import {
  alignShapes,
  importSvg,
  initialPlacement,
  parseStl,
  type ToolpathContext,
} from "@furrow/cam-core";
import {
  createProjectDocument,
  type Machine,
  type Model,
  type Operation,
  type Path,
  type Point,
  type ProfileTabs,
  ProjectDocument,
  type Shape,
  type Stock,
  type Tool,
} from "@furrow/document";
import {
  ballEndMill,
  drill,
  endMill,
  lowRider,
  machine as shapeoko,
  vBit,
} from "@furrow/document/fixtures";
import flutedDoorsSvg from "./fixtures/fluted-doors.svg?raw";
import panelSvg from "./fixtures/panel-inches.svg?raw";
import partSvg from "./fixtures/part.svg?raw";
import shelfSvg from "./fixtures/pc-shelf.svg?raw";
import shelfHandleSvg from "./fixtures/pc-shelf-handle.svg?raw";
import pyramidStl from "./fixtures/pyramid.stl?raw";
import signSvg from "./fixtures/sign.svg?raw";
import strutPlatesSvg from "./fixtures/strut-plates.svg?raw";

export type CorpusProject = {
  /** The file name of its program in `programs/`, without the extension. */
  name: string;
  /** The project's name, written in the program's header. */
  title: string;
  /** What it covers, for whoever reads a failing test. */
  covers: string;
  document: ProjectDocument;
  /** The meshes of its models, for 3D operations. */
  context?: ToolpathContext;
  /** The export's warnings, if it should have any. */
  warnings?: string[];
};

/** Ids that stay the same from run to run, so the programs do too. */
function ids(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

/**
 * `shapes` added to `doc` the way the workspace imports a file: aligned to
 * the stock at the XY zero's anchor, or its bottom-left corner for a custom
 * zero (ADR-0022).
 */
function withShapes(doc: ProjectDocument, shapes: Shape[]): ProjectDocument {
  const { anchor } = doc.stock.xyOrigin;
  return {
    ...doc,
    geometry: alignShapes(doc.stock, shapes, anchor === "custom" ? "bottom_left" : anchor),
  };
}

/** Targets for every shape `pick` matches, all their paths. */
function targets(doc: ProjectDocument, pick: (shape: Shape) => boolean): Operation["targets"] {
  const picked = doc.geometry.filter(pick).map((shape) => ({ shapeId: shape.id, paths: null }));
  if (picked.length === 0) throw new Error("The corpus project targets no shapes");
  return picked;
}

const byName = (name: string) => (shape: Shape) => shape.name === name;
const byLayer = (layer: string) => (shape: Shape) => shape.layer === layer;

function project(stock: Stock, machine: ProjectDocument["machine"]): ProjectDocument {
  return { ...createProjectDocument(), stock, machine };
}

/** Fails loudly when a corpus project stops being a valid document. */
function valid(doc: ProjectDocument): ProjectDocument {
  return ProjectDocument.parse(doc);
}

function rectangle([x, y]: Point, width: number, height: number): Path {
  return {
    start: [x, y],
    segments: [
      { kind: "line", to: [x + width, y] },
      { kind: "line", to: [x + width, y + height] },
      { kind: "line", to: [x, y + height] },
    ],
    closed: true,
  };
}

function circle(center: Point, radius: number): Path {
  const start: Point = [center[0] + radius, center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}

/**
 * A plate with a recess and three holes, cut out with tabs: the PRD's test
 * part (PRD-0001), drawn by hand rather than imported.
 */
function plate(): ProjectDocument {
  const id = ids("10000000");
  const shape = (name: string, ...paths: Path[]): Shape => ({ id: id(), name, layer: "0", paths });
  const outline = shape("Plate", rectangle([20, 20], 120, 80));
  const holes = shape("Holes", circle([40, 40], 3), circle([120, 40], 3), circle([80, 80], 3));
  const recess = shape("Recess", rectangle([60, 50], 40, 20));
  const profile: Operation = {
    id: id(),
    type: "profile",
    name: "Cut out",
    enabled: true,
    targets: [{ shapeId: outline.id, paths: null }],
    tool: endMill,
    params: {
      side: "outside",
      direction: "climb",
      depth: 6,
      allowance: 0,
      finishPass: false,
      leadIn: null,
      ramp: false,
      tabs: { width: 6, height: 2, positions: [[80, 20]] },
    },
  };
  return {
    ...project(
      {
        width: 160,
        height: 120,
        thickness: 6,
        xyOrigin: { anchor: "bottom_left" },
        zOrigin: "stock_top",
      },
      shapeoko,
    ),
    geometry: [outline, holes, recess],
    operations: [
      {
        id: id(),
        type: "drill",
        name: "Holes",
        enabled: true,
        targets: [{ shapeId: holes.id, paths: null }],
        tool: drill,
        params: { depth: 6, peck: true },
      },
      {
        id: id(),
        type: "pocket",
        name: "Recess",
        enabled: true,
        targets: [{ shapeId: recess.id, paths: null }],
        tool: endMill,
        params: {
          strategy: { type: "offset" },
          direction: "climb",
          depth: 3,
          allowance: 0,
          finishPass: false,
          ramp: true,
        },
      },
      profile,
      { ...profile, id: id(), name: "Disabled", enabled: false },
    ],
  };
}

/**
 * An SVG of a part: a 100 × 60 mm rounded outline, four Ø8 mm holes
 * profiled from the inside and a 52 × 12 mm slot. The holes plunge: a ramp
 * at the bit's 3° around their 0.8 mm radius takes dozens of turns.
 */
function svgPart(): ProjectDocument {
  const id = ids("20000000");
  const { shapes } = importSvg(partSvg, { fileName: "part.svg", createId: id });
  const doc = withShapes(
    project(
      {
        width: 140,
        height: 100,
        thickness: 12,
        xyOrigin: { anchor: "center" },
        zOrigin: "machine_bed",
      },
      shapeoko,
    ),
    shapes,
  );
  return {
    ...doc,
    operations: [
      {
        id: id(),
        type: "profile",
        name: "Holes",
        enabled: true,
        targets: targets(doc, byLayer("Holes")),
        tool: endMill,
        params: {
          side: "inside",
          direction: "climb",
          depth: 12,
          allowance: 0,
          finishPass: false,
          leadIn: null,
          ramp: false,
          tabs: null,
        },
      },
      {
        id: id(),
        type: "pocket",
        name: "Slot",
        enabled: true,
        targets: targets(doc, byLayer("Pocket")),
        tool: endMill,
        params: {
          strategy: { type: "linear", angle: 45 },
          direction: "conventional",
          depth: 4,
          allowance: 0.3,
          finishPass: true,
          ramp: false,
        },
      },
      {
        id: id(),
        type: "profile",
        name: "Cut out",
        enabled: true,
        targets: targets(doc, byLayer("Outline")),
        tool: endMill,
        params: {
          side: "outside",
          direction: "climb",
          depth: 12,
          allowance: 0.5,
          finishPass: true,
          leadIn: { radius: 4 },
          ramp: true,
          tabs: {
            width: 8,
            height: 3,
            positions: [
              [70, 20],
              [70, 80],
            ],
          },
        },
      },
    ],
  };
}

/**
 * Inkscape's SVG of a sign, 180 × 80 mm with rounded corners, a Ø8 mm hole
 * and a 20 mm square, cut on a LowRider: manual spindle, custom tool change.
 */
function svgSign(): ProjectDocument {
  const id = ids("30000000");
  const { shapes } = importSvg(signSvg, { fileName: "sign.svg", createId: id });
  const doc = withShapes(
    project(
      {
        width: 200,
        height: 100,
        thickness: 18,
        xyOrigin: { anchor: "bottom_left" },
        zOrigin: "stock_top",
      },
      lowRider,
    ),
    shapes,
  );
  return {
    ...doc,
    operations: [
      {
        id: id(),
        type: "engrave",
        name: "Border",
        enabled: true,
        targets: targets(doc, byName("rect1")),
        tool: vBit,
        params: { side: "on", depth: 1.5, ramp: false },
      },
      {
        id: id(),
        type: "vcarve",
        name: "Square",
        enabled: true,
        targets: targets(doc, byName("path3")),
        tool: vBit,
        params: { maxDepth: 3, flatBottom: { tool: endMill } },
      },
      {
        id: id(),
        type: "drill",
        name: "Hanging hole",
        enabled: true,
        targets: targets(doc, byName("Hole A")),
        // An end mill smaller than the hole bores it in a helix.
        tool: endMill,
        params: { depth: 10, peck: false },
      },
    ],
  };
}

const inch = 25.4;

/**
 * A panel drawn in inches, in a project shown in inches (PRD-0001 R14):
 * zeroed at a custom point, a frame cut on the line, a window pocketed
 * around a knob and a V-shaped label engraved with an end mill.
 */
function inchPanel(): ProjectDocument {
  const id = ids("40000000");
  const { shapes } = importSvg(panelSvg, { fileName: "panel-inches.svg", createId: id });
  const doc = withShapes(
    {
      ...project(
        {
          width: 4 * inch,
          height: 3 * inch,
          thickness: 0.5 * inch,
          xyOrigin: { anchor: "custom", x: inch, y: inch },
          zOrigin: "stock_top",
        },
        shapeoko,
      ),
      units: "in",
    },
    shapes,
  );
  return {
    ...doc,
    operations: [
      {
        id: id(),
        type: "engrave",
        name: "Label",
        enabled: true,
        targets: targets(doc, byName("Label")),
        tool: endMill,
        params: { side: "on", depth: 0.04 * inch, ramp: true },
      },
      {
        id: id(),
        type: "pocket",
        name: "Window",
        enabled: true,
        targets: targets(doc, (shape) => shape.name === "Window" || shape.name === "Knob"),
        tool: endMill,
        params: {
          strategy: { type: "peel", start: "inside" },
          direction: "climb",
          depth: 0.25 * inch,
          allowance: 0,
          finishPass: false,
          ramp: true,
        },
      },
      {
        id: id(),
        type: "profile",
        name: "Frame",
        enabled: true,
        targets: targets(doc, byName("Frame")),
        tool: endMill,
        params: {
          side: "on",
          direction: "conventional",
          depth: 0.5 * inch,
          allowance: 0,
          finishPass: false,
          leadIn: null,
          ramp: false,
          tabs: null,
        },
      },
    ],
  };
}

/** A 1.5 mm ball end mill, for rest finishing after the 3 mm one. */
const smallBall: Tool = { ...ballEndMill, name: "1.5 mm ball end mill", diameter: 1.5 };

/**
 * A 40 × 30 × 8 mm pyramid from an ASCII STL, placed as the workspace places
 * a new model (ADR-0031): roughed out, finished, then rest-finished with a
 * smaller ball end mill.
 */
function relief(): { document: ProjectDocument; context: ToolpathContext } {
  const id = ids("50000000");
  const mesh = parseStl(new TextEncoder().encode(pyramidStl));
  const base = project(
    {
      width: 40,
      height: 30,
      thickness: 10,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
    },
    shapeoko,
  );
  const sha256 = "5e1f0c9d2b7a4e3f8c6d1a0b9e8f7c6d5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d";
  const model: Model = {
    id: id(),
    sha256,
    fileName: "pyramid.stl",
    size: pyramidStl.length,
    triangles: mesh.triangles,
    bounds: mesh.bounds,
    // The stock's size: 40 × 30 × 8 mm.
    placement: initialPlacement(mesh.bounds, base.stock, "bottom_left"),
  };
  const finish = (name: string, tool: Tool, rest: boolean): Operation => ({
    id: id(),
    type: "relief_finish",
    name,
    enabled: true,
    targets: [],
    tool,
    params: {
      modelId: model.id,
      angle: 45,
      stepOver: 50,
      direction: "zigzag",
      stockToLeave: 0,
      rest,
    },
  });
  return {
    document: {
      ...base,
      models: [model],
      operations: [
        {
          id: id(),
          type: "relief_rough",
          name: "Rough",
          enabled: true,
          targets: [],
          tool: endMill,
          params: {
            modelId: model.id,
            strategy: { type: "offset" },
            direction: "climb",
            stepOver: null,
            stockToLeave: 0.5,
            boundary: "stock",
            ramp: true,
            rest: false,
          },
        },
        finish("Finish", ballEndMill, false),
        finish("Rest finish", smallBall, true),
      ],
    },
    context: { mesh: (hash) => (hash === sha256 ? mesh.positions : undefined) },
  };
}

// Jobs cut in a real workshop, from the drawings they were cut from, with
// the bits, depths, feeds and tabs of the Estlcam programs that cut them: the
// G-code users replace with ours.

/** A LowRider v4 with a Jackpot controller and a PWM spindle, as the workshop runs it. */
const workshopLowRider: Machine = {
  ...lowRider,
  name: "LowRider v4 (Jackpot, spindle)",
  maxFeedXY: 2520,
  maxFeedZ: 900,
  spindleRpmMin: 6000,
  spindleRpmMax: 24000,
  toolChange: null,
};

/** The workshop's bits, from its Estlcam tool list, at the feeds its programs cut at. */
const workshopTool = {
  ...endMill,
  fluteCount: 2,
  cutDirection: "upcut",
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  notes: null,
} as const satisfies Partial<Tool>;
const spiral6: Tool = {
  ...workshopTool,
  name: "6 mm spiral",
  diameter: 6,
  fluteCount: 3,
  fluteLength: 42,
  plungeAngle: 45,
  stepDown: 3,
  stepOver: 75,
};
const spiral3: Tool = {
  ...spiral6,
  name: "3 mm spiral",
  diameter: 3,
  fluteLength: 12,
  stepDown: 1.5,
};
const spiral8: Tool = {
  ...spiral6,
  name: "8 mm wood bit",
  diameter: 8,
  fluteLength: 25,
  stepDown: 2,
};
const straight19: Tool = {
  ...workshopTool,
  name: "19 mm straight",
  diameter: 19,
  fluteLength: 32,
  plungeAngle: 20,
  stepDown: 1.5,
  stepOver: 75,
};
const tornado35: Tool = {
  ...workshopTool,
  name: "Tornado 35 mm",
  diameter: 35,
  fluteCount: 1,
  fluteLength: 10,
  plungeAngle: 5,
  stepDown: 0.75,
  stepOver: 75,
};
/**
 * A bowl bit, 44.45 mm across with a 41.91 mm profile: there is no such
 * tool type, so a ball end mill as wide, whose groove at the 4 mm the doors
 * are cut to is as wide within a millimetre (#155).
 */
const bowl44: Tool = {
  ...workshopTool,
  name: "Bowl 44.45 mm",
  type: "ball_end_mill",
  diameter: 44.45,
  fluteLength: 12,
  feedRate: 720,
  plungeRate: 150,
  plungeAngle: 45,
  stepDown: 3,
  stepOver: 10,
};

function outsideProfile(
  id: () => string,
  name: string,
  targets: Operation["targets"],
  tool: Tool,
  depth: number,
  tabs: ProfileTabs | null,
): Operation {
  return {
    id: id(),
    type: "profile",
    name,
    enabled: true,
    targets,
    tool,
    params: {
      side: "outside",
      direction: "climb",
      depth,
      allowance: 0,
      finishPass: false,
      leadIn: null,
      ramp: true,
      tabs,
    },
  };
}

/**
 * Two 5 mm strut plates exported from OpenSCAD as one path, their 28 Ø5.3 mm
 * holes 35-sided polygons. Estlcam drilled the left plate's holes with a
 * helix; drilling needs circles, so here they are profiled from the inside
 * (#154).
 */
function strutPlate(): ProjectDocument {
  const id = ids("60000000");
  const { shapes } = importSvg(strutPlatesSvg, { fileName: "strut-plates.svg", createId: id });
  const doc = withShapes(
    project(
      {
        width: 1080,
        height: 190,
        thickness: 5,
        xyOrigin: { anchor: "center" },
        zOrigin: "stock_top",
      },
      workshopLowRider,
    ),
    shapes,
  );
  const plates = doc.geometry[0] as Shape;
  // The left plate's outline, then its 14 holes.
  const holes = Array.from({ length: 14 }, (_, i) => i + 1);
  return {
    ...doc,
    operations: [
      {
        id: id(),
        type: "profile",
        name: "Holes",
        enabled: true,
        targets: [{ shapeId: plates.id, paths: holes }],
        tool: spiral3,
        params: {
          side: "inside",
          direction: "climb",
          depth: 5,
          allowance: 0,
          finishPass: false,
          leadIn: null,
          ramp: false,
          tabs: null,
        },
      },
      outsideProfile(id, "Plate", [{ shapeId: plates.id, paths: [0] }], spiral6, 5, null),
    ],
  };
}

/**
 * A 40 mm shelf for a PC case, 260 × 380 mm with 20 mm corners: a channel
 * cleared 30 mm deep with a 19 mm bit, a recess skimmed 5 mm deep with a
 * 35 mm one over it, and the shelf cut out on four tabs.
 */
function pcShelf(): ProjectDocument {
  const id = ids("70000000");
  const { shapes } = importSvg(shelfSvg, { fileName: "pc-shelf.svg", createId: id });
  const doc = withShapes(
    project(
      {
        width: 290,
        height: 410,
        thickness: 40,
        xyOrigin: { anchor: "center" },
        zOrigin: "stock_top",
      },
      workshopLowRider,
    ),
    shapes,
  );
  const pocket = (name: string, shape: string, tool: Tool, depth: number): Operation => ({
    id: id(),
    type: "pocket",
    name,
    enabled: true,
    targets: targets(doc, byName(shape)),
    tool,
    params: {
      strategy: { type: "linear", angle: 90 },
      direction: "climb",
      depth,
      allowance: 0,
      finishPass: false,
      ramp: true,
    },
  });
  // The shelf is 260 × 380 mm, centred on the 290 × 410 mm stock.
  const tabs: ProfileTabs = {
    width: 10,
    height: 10,
    positions: [
      [15, 205],
      [275, 205],
      [145, 20],
      [145, 390],
    ],
  };
  return {
    ...doc,
    operations: [
      pocket("Channel", "rect1-3-3", straight19, 30),
      pocket("Recess", "rect1-3", tornado35, 5),
      outsideProfile(id, "Cut out", targets(doc, byName("rect1")), spiral6, 40, tabs),
    ],
  };
}

/** The shelf's 150 × 54 mm handle, cut out of 18 mm board on one tab. */
function pcShelfHandle(): ProjectDocument {
  const id = ids("80000000");
  const { shapes } = importSvg(shelfHandleSvg, { fileName: "pc-shelf-handle.svg", createId: id });
  const doc = withShapes(
    project(
      {
        width: 170,
        height: 74,
        thickness: 18,
        xyOrigin: { anchor: "center" },
        zOrigin: "stock_top",
      },
      workshopLowRider,
    ),
    shapes,
  );
  const tabs: ProfileTabs = { width: 10, height: 5, positions: [[85, 10]] };
  return {
    ...doc,
    operations: [outsideProfile(id, "Cut out", targets(doc, byName("rect1")), spiral8, 18, tabs)],
  };
}

/**
 * Two fluted cabinet doors side by side, 815 × 1135 mm: 56 open lines at 30°,
 * each running past the panel so the bit enters and leaves the panel at full
 * depth, grooved 4 mm deep with a bowl bit. The panel's outline is a
 * reference, not cut.
 */
function flutedDoors(): ProjectDocument {
  const id = ids("90000000");
  const { shapes } = importSvg(flutedDoorsSvg, { fileName: "fluted-doors.svg", createId: id });
  // The drawing is centred on the panel, so its outline lands on the stock.
  const doc = withShapes(
    project(
      {
        width: 815,
        height: 1135,
        thickness: 18,
        xyOrigin: { anchor: "center" },
        zOrigin: "stock_top",
      },
      workshopLowRider,
    ),
    shapes,
  );
  return {
    ...doc,
    operations: [
      {
        id: id(),
        type: "engrave",
        name: "Flutes",
        enabled: true,
        targets: targets(doc, byLayer("cannettature")),
        tool: bowl44,
        params: { side: "on", depth: 4, ramp: true },
      },
    ],
  };
}

/** Every project, in the order their programs are checked. */
export function corpus(): CorpusProject[] {
  const lowRiderPlate = plate();
  lowRiderPlate.machine = lowRider;
  lowRiderPlate.stock = {
    ...lowRiderPlate.stock,
    xyOrigin: { anchor: "center" },
    zOrigin: "machine_bed",
  };
  const pyramid = relief();
  return [
    {
      name: "plate-shapeoko",
      title: "Plate",
      covers: "peck drilling, offset pocket with ramps, outside profile with a tab",
      document: valid(plate()),
    },
    {
      name: "plate-lowrider",
      title: "Plate",
      covers: "the same part zeroed at the centre of the machine bed, manual spindle",
      document: valid(lowRiderPlate),
      // The LowRider's Z is slower than the tab's climb.
      warnings: ["Cut out: 1 move slowed to the machine's maximum feed."],
    },
    {
      name: "svg-part",
      title: "Part",
      covers: "SVG import, inside profiles, linear pocket with a finish pass, lead-ins and tabs",
      document: valid(svgPart()),
    },
    {
      name: "svg-sign",
      title: "Sign",
      covers: "SVG import, V-bit engraving, V-carve with a flat bottom, helical boring",
      document: valid(svgSign()),
      // The V-carve plunges faster than the LowRider's Z.
      warnings: ["Square: 5 moves slowed to the machine's maximum feed."],
    },
    {
      name: "inch-panel",
      title: "Panel",
      covers: "a drawing in inches, custom zero, engraving, peel pocket around an island",
      document: valid(inchPanel()),
    },
    {
      name: "relief",
      title: "Relief",
      covers: "STL import, 3D roughing, finishing and rest finishing",
      document: valid(pyramid.document),
      context: pyramid.context,
    },
    {
      name: "strut-plate",
      title: "Strut plate",
      covers: "an OpenSCAD export: holes as polygons, a metre-long plate on a LowRider",
      document: valid(strutPlate()),
    },
    {
      name: "pc-shelf",
      title: "PC shelf",
      covers: "deep clearing with a 19 mm bit, skimming with a 35 mm one, four tabs in 40 mm",
      document: valid(pcShelf()),
    },
    {
      name: "pc-shelf-handle",
      title: "PC shelf handle",
      covers: "a cut-out of 18 mm board on one tab",
      document: valid(pcShelfHandle()),
    },
    {
      name: "fluted-doors",
      title: "Fluted doors",
      covers: "56 open lines engraved past the stock's edges, with a 44 mm bit",
      document: valid(flutedDoors()),
    },
  ];
}
