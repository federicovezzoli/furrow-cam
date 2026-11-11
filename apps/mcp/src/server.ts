import {
  IMAGE_RELIEF,
  MAX_TERRAIN_SPAN,
  MIN_LENGTH,
  TERRAIN_BASE,
  TERRAIN_EXAGGERATION,
} from "@furrow/cam-core";
import { FlipAxis, PinHoles, StockAnchor, StockCorner } from "@furrow/document";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { fitToStock, importFile, resize, setTop, turn } from "./drawings-and-models";
import { checkProject, computeToolpaths, exportProject, type Progress } from "./gcode";
import { importImageRelief } from "./image-relief";
import { libraryDir, readLibrary } from "./library";
import {
  addOperation,
  editOperation,
  moveTo,
  type NewOperation,
  type OperationType,
  removeOperation,
} from "./operations";
import { createProjects, type Project, type Projects, ToolError } from "./projects";
import {
  chooseMachine,
  setStock,
  setToolOf,
  setTouchOff,
  setTwoSidedSetup,
  setZero,
} from "./setup";
import { projectSummary } from "./summary";
import { importTerrain, type TerrainArea } from "./terrain";
import { topView } from "./top-view";

const projectPath = z
  .string()
  .describe(
    "Absolute path of the project file: .furrow, or .furrow.zip or .furrow.json to open one exported from the web app. It saves as .furrow next to it.",
  );

/** A tool's result as JSON for the assistant. */
const asJson = (result: unknown): CallToolResult["content"] => [
  { type: "text", text: JSON.stringify(result, null, 2) },
];

/** `run`'s result for the assistant, as `content` says, or its `ToolError` as a tool error. */
async function reply<T>(
  run: () => Promise<T>,
  content: (result: T) => CallToolResult["content"],
): Promise<CallToolResult> {
  try {
    return { content: content(await run()) };
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
}

/** Reports a computation's progress to the client, if it asked for it. */
function progressOf({
  _meta,
  sendNotification,
}: RequestHandlerExtra<ServerRequest, ServerNotification>): Progress | undefined {
  const progressToken = _meta?.progressToken;
  if (progressToken === undefined) return undefined;
  return (progress, total, operation) =>
    sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        total,
        ...(operation && { message: `Computing “${operation}”` }),
      },
    });
}

function summary(project: Project) {
  return {
    path: project.source,
    savesTo: project.path,
    ...projectSummary(project.store.getState().document),
  };
}

/**
 * The local MCP server (PRD-0012, ADR-0067), with no transport yet, reading
 * the desktop app's tool library and machine list from `library`.
 */
export function createServer(projects: Projects = createProjects(), library = libraryDir()) {
  const server = new McpServer({ name: "furrow-cam", version: packageJson.version });

  /**
   * `reply`, once the projects `run` changed are saved to their own files,
   * so the desktop app shows each change (#492). A project that couldn't be
   * saved is reported after the result, as text of its own, its changes kept here.
   */
  const respond = <T>(
    run: () => Promise<T>,
    content: (result: T) => CallToolResult["content"] = asJson,
  ) =>
    reply(
      async () => ({ result: await run(), notSaved: await projects.saveChanges() }),
      ({ result, notSaved }) => [
        ...content(result),
        ...notSaved.map((problem) => ({
          type: "text" as const,
          text: `Not saved to the project file, the change is kept in this server: ${problem}`,
        })),
      ],
    );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Creates an empty Furrow CAM project file (.furrow): 600 × 400 × 18 mm stock in millimetres, zero at the bottom-left corner of the stock top, no machine. Refuses a path that already exists. Returns the project summary.",
      inputSchema: { path: projectPath },
    },
    ({ path }) => respond(async () => summary(await projects.create(path))),
  );

  server.registerTool(
    "open_project",
    {
      title: "Open a project",
      description:
        "Opens a Furrow CAM project from its file, dropping any changes to it this server hasn't saved, and returns its summary. Other tools open a project on first use, so this is only needed to reload it.",
      inputSchema: { path: projectPath },
    },
    ({ path }) => respond(async () => summary(await projects.open(path))),
  );

  server.registerTool(
    "get_project",
    {
      title: "Summarise a project",
      description:
        "Returns a project's summary: the path to call tools with, the .furrow file it saves to, units, stock and zero, machine, drawings with their shapes and bounds, 3D models, and operations in cutting order with all their settings. Drawings, shapes and models marked hidden aren't cut (an operation cutting only hidden ones is off), and locked ones can't be picked in the app. Lengths are in millimetres, feed rates in mm/min; the stock and zero are also given in the project's units.",
      inputSchema: { path: projectPath },
      annotations: { readOnlyHint: true },
    },
    ({ path }) => respond(async () => summary(await projects.get(path))),
  );

  server.registerTool(
    "save_project",
    {
      title: "Save a project",
      description:
        "Every change to a project opened from its own .furrow file is saved to that file as it's made, so the desktop app, if it has the project open, shows it at once; a tool's result ends with a note for any project that couldn't be, e.g. because its file changed meanwhile, once, until its next change. This tool saves a project opened from a .furrow.zip or .furrow.json as .furrow next to it, which is then saved as it changes; with saveAs, it saves the project to that path instead and keeps saving there. Never replaces another file, nor the project's own if it changed since it was read (for example saved in the app with changes this server hasn't saved). Changes the user saved in the app are read before the project's next change. The first change since the project was opened is preceded by an automatic version (\"Before the assistant's changes\") the user can restore in the app.",
      inputSchema: {
        path: projectPath,
        saveAs: projectPath.optional().describe("Absolute path to save to instead, a new file."),
      },
    },
    ({ path, saveAs }) =>
      respond(async () => ({ saved: await projects.save(await projects.get(path), saveAs) })),
  );

  server.registerTool(
    "check_project",
    {
      title: "Check a project",
      description:
        "Computes the toolpaths of a project's enabled operations, as the app does, and returns what the app would show for them: enabled operations whose tool can't cut them (toolProblems), the toolpath and program warnings, and whether there is anything to export (canExport, with whyNot if not, or the G-code files an export would write). Changes nothing. Reports progress as it computes; 3D operations can take a while.",
      inputSchema: { path: projectPath },
      annotations: { readOnlyHint: true },
    },
    ({ path }, extra) =>
      respond(async () => checkProject(await projects.get(path), progressOf(extra), extra.signal)),
  );

  server.registerTool(
    "export_gcode",
    {
      title: "Export G-code",
      description:
        "Computes a project's toolpaths and writes its G-code for the machine's post-processor, byte for byte what the app exports: one file named after the project and today's date (the app may also add the label of the version last saved or restored; this server never does) (e.g. sign-2026-11-01.gcode), or one per side of a two-sided project (sign-2026-11-01-top.gcode, sign-2026-11-01-bottom.gcode). Writes next to the project's .furrow file unless given a folder. Never replaces a file unless overwrite is true. Saved or not, it exports the project as it is in this server. Returns the files written and the export's warnings. Never sends anything to a machine: the user loads and runs the G-code.",
      inputSchema: {
        path: projectPath,
        folder: z.string().optional().describe("Absolute path of the folder to write into."),
        overwrite: z.boolean().optional().describe("Replace G-code files already there."),
      },
    },
    ({ path, folder, overwrite }, extra) =>
      respond(async () =>
        exportProject(
          await projects.get(path),
          { folder, overwrite },
          progressOf(extra),
          extra.signal,
        ),
      ),
  );

  server.registerTool(
    "get_top_view",
    {
      title: "Show the toolpaths from above",
      description:
        "Computes a project's toolpaths, as check_project does, and returns a top view of one side as a PNG image: the stock (light, with its edge), the drawings' shapes (dark grey), and each enabled operation's cutting moves in its tool's colour (a V-carve's flat bottom in its end mill's), with a circle the size of the tool at each hole drilled straight down (a hole bored wider than the tool shows its rings instead); rapids are left out. X runs right and Y up, as seen from above; the image fits the stock and anything cut past its edges. A legend in JSON follows: the operation each colour is, the millimetres per pixel, and the area shown in stock coordinates (millimetres from the stock's bottom-left corner). Show it to the user, or look at it to check what was built. Changes nothing.",
      inputSchema: {
        path: projectPath,
        side: z
          .enum(["top", "bottom"])
          .optional()
          .describe("Which side of a two-sided project; the top if left out."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, side = "top" }, extra) =>
      respond(
        async () => {
          const project = await projects.get(path);
          const { document } = project.store.getState();
          if (side === "bottom" && !document.stock.twoSided) {
            throw new ToolError("The project isn't two-sided: it has only a top side.");
          }
          // shortcut: computes both sides' toolpaths to draw one; compute only that side's (and the ones rest machining needs) if two-sided projects make this slow.
          const computed = await computeToolpaths(
            project,
            document,
            progressOf(extra),
            extra.signal,
          );
          return topView(document, computed, side);
        },
        ({ png, legend }) => [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify(legend, null, 2) },
        ],
      ),
  );

  const itemId = z.string().describe("The drawing's or model's id, from the project summary.");

  server.registerTool(
    "import_file",
    {
      title: "Import a drawing or 3D model",
      description:
        "Imports an SVG or DXF drawing, or an STL or STEP 3D model, into a project, as the app does. A project holds drawings (several, each its own) and at most one model. Drawings keep their size in the file; a STEP solid is turned into a triangle mesh, as in the app, and models are fitted inside the stock; both are placed at the zero's corner or centre, which fit_to_stock and resize can change. An SVG sized in pixels or not at all needs dpi, and a DXF that doesn't say its units needs units: without them the import is refused, saying so; ask the user rather than guessing. Returns the new drawing's or model's id, the import's warnings and the project summary.",
      inputSchema: {
        path: projectPath,
        file: z.string().describe("Absolute path of the .svg, .dxf, .stl or .step (.stp) file."),
        dpi: z
          .number()
          .positive()
          .optional()
          .describe("Pixels per inch of an SVG sized in pixels or not at all."),
        units: z
          .enum(["mm", "in"])
          .optional()
          .describe("The unit of a DXF's coordinates, when the file doesn't say."),
      },
    },
    ({ path, file, dpi, units }) =>
      respond(async () => {
        const project = await projects.get(path);
        const imported = await importFile(project, file, { dpi, units });
        return { ...imported, ...summary(project) };
      }),
  );

  const kilometres = z
    .number()
    .positive()
    .max(MAX_TERRAIN_SPAN / 1000);
  server.registerTool(
    "import_terrain",
    {
      title: "Make a terrain from a map area",
      description: `Makes a relief model of a real place from open elevation data and adds it to a project as its model, as the app's Terrain from a map does: placed at the chosen size, centred on the stock, its top at the stock top, then machined like any model (add_relief_rough, add_relief_finish). A project holds at most one model. The area is a rectangle or ellipse (a square or circle has equal sides) about a centre, or a ring of points. The centre is latitude and longitude ("45.92, 9.39") or a full Google Maps or OpenStreetMap link; place names are not searched, so give coordinates you know or ask the user for a link. At most ${MAX_TERRAIN_SPAN / 1000} km across. This is the one tool that uses the network: it downloads the area's elevation tiles from Mapterhorn (tiles.mapterhorn.com), which receives the user's IP address and which tiles they are, and nothing else. Detail is as fine as the STL limits allow. Returns the model's id, size in mm, lowest and highest heights in metres, detail (ground metres and mm per cell), the credit the data asks for (give it to the user), and the project summary.`,
      inputSchema: {
        path: projectPath,
        centre: z
          .string()
          .optional()
          .describe(
            "The area's centre: latitude, longitude in degrees, or a full Google Maps or OpenStreetMap link. With shape, widthKm and depthKm.",
          ),
        shape: z
          .enum(["rectangle", "ellipse"])
          .optional()
          .describe("The area's shape about centre."),
        widthKm: kilometres.optional().describe("The area's width, east to west, in km."),
        depthKm: kilometres.optional().describe("The area's depth, south to north, in km."),
        ring: z
          .array(z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]))
          .min(3)
          .optional()
          .describe(
            "Instead of centre and shape: the area's outline as [longitude, latitude] points in degrees.",
          ),
        name: z
          .string()
          .optional()
          .describe("The model's name, usually the place's; \"Terrain\" if left out."),
        longestSide: z
          .number()
          .min(1)
          .optional()
          .describe(
            "The model's longest side in mm; by default, and at most, what fits inside the stock less the model border.",
          ),
        exaggeration: z
          .number()
          .min(TERRAIN_EXAGGERATION.min)
          .max(TERRAIN_EXAGGERATION.max)
          .default(TERRAIN_EXAGGERATION.initial)
          .describe("How much taller than true scale the relief is."),
        base: z
          .number()
          .min(TERRAIN_BASE.min)
          .default(TERRAIN_BASE.initial)
          .describe("The model's thickness under its lowest point, in mm."),
        stl: z
          .string()
          .optional()
          .describe(
            "Absolute path to also write the terrain to as an STL file, e.g. for 3D printing.",
          ),
        overwrite: z.boolean().optional().describe("Replace the STL file if it exists."),
      },
    },
    ({ path, centre, shape, widthKm, depthKm, ring, ...settings }, extra) =>
      respond(async () => {
        let area: TerrainArea;
        if (ring) {
          if (centre !== undefined || shape || widthKm || depthKm) {
            throw new ToolError("Give either ring, or centre with shape, widthKm and depthKm.");
          }
          area = { ring };
        } else if (centre !== undefined && shape && widthKm && depthKm) {
          area = { centre, shape, widthKm, depthKm };
        } else {
          throw new ToolError("Give the area: centre with shape, widthKm and depthKm, or ring.");
        }
        const open = () => projects.get(path);
        const terrain = await importTerrain(
          open,
          { area, ...settings },
          progressOf(extra),
          extra.signal,
        );
        return { ...terrain, ...summary(await open()) };
      }),
  );

  server.registerTool(
    "import_image_relief",
    {
      title: "Make a relief from an image",
      description:
        "Makes a relief model from a greyscale PNG, JPEG or WebP image (a depth map, a logo, a photo for a lithophane) and adds it to a project as its model, as the app's Relief from image does: lighter is higher (darker with invert), transparent counts as black, placed at the chosen width (the depth follows the image's aspect ratio), centred on the stock, its top at the stock top, then machined like any model (add_relief_rough, add_relief_finish). A project holds at most one model. Detail is as fine as the STL limits and the image's pixels allow. Returns the model's id, size in mm, the image's pixels, the cells across and along, and the project summary.",
      inputSchema: {
        path: projectPath,
        image: z.string().describe("Absolute path of the .png, .jpg or .webp image."),
        name: z
          .string()
          .optional()
          .describe("The model's name; the image's file name if left out."),
        width: z
          .number()
          .min(1)
          .optional()
          .describe(
            "The model's width in mm; by default, and at most, what fits inside the stock less the model border.",
          ),
        relief: z
          .number()
          .min(IMAGE_RELIEF.relief.min)
          .default(IMAGE_RELIEF.relief.initial)
          .describe("How much higher white is than black, in mm."),
        base: z
          .number()
          .min(IMAGE_RELIEF.base.min)
          .default(IMAGE_RELIEF.base.initial)
          .describe("The model's thickness under black, in mm."),
        invert: z
          .boolean()
          .default(false)
          .describe("Dark is higher, e.g. for a lithophane cut from the back."),
        blur: z
          .number()
          .int()
          .min(IMAGE_RELIEF.blur.min)
          .max(IMAGE_RELIEF.blur.max)
          .default(IMAGE_RELIEF.blur.initial)
          .describe("Smoothing against pixel noise: a box blur's radius in image pixels."),
      },
    },
    ({ path, ...request }) =>
      respond(async () => {
        const project = await projects.get(path);
        const relief = await importImageRelief(project, request);
        return { ...relief, ...summary(project) };
      }),
  );

  server.registerTool(
    "fit_to_stock",
    {
      title: "Fit a drawing or model to the stock",
      description:
        "Scales a drawing or model, keeping its proportions, to fit inside the stock less its border (10 mm unless changed in the app), placed at the zero's corner or centre, as the app's Fit to stock does. Returns the project summary.",
      inputSchema: { path: projectPath, id: itemId },
    },
    ({ path, id }) =>
      respond(async () => {
        const project = await projects.get(path);
        fitToStock(project, id);
        return summary(project);
      }),
  );

  server.registerTool(
    "resize",
    {
      title: "Resize a drawing or model",
      description:
        "Sets a drawing's or model's width or height, or a model's depth (how far it reaches into the stock from its top), in millimetres, scaling it the same in every direction so it keeps its proportions, about its point at the zero's corner or centre, as the app's size fields do. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        id: itemId,
        side: z.enum(["width", "height", "depth"]).describe("Which size to set."),
        mm: z.number().min(MIN_LENGTH).describe("The size, in millimetres."),
      },
    },
    ({ path, id, side, mm }) =>
      respond(async () => {
        const project = await projects.get(path);
        resize(project, id, side, mm);
        return summary(project);
      }),
  );

  server.registerTool(
    "set_model_top",
    {
      title: "Sink a model below the stock top",
      description:
        "Sets how far a model's top sits below the stock top, in millimetres (0 puts it at the stock top), keeping its size, as the app's Top below stock field does: the whole relief is machined that much lower, for example to recover a part roughed too deep or to leave a border standing proud. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        id: itemId,
        mm: z.number().min(0).describe("How far below the stock top, in millimetres."),
      },
    },
    ({ path, id, mm }) =>
      respond(async () => {
        const project = await projects.get(path);
        setTop(project, id, mm);
        return summary(project);
      }),
  );

  server.registerTool(
    "turn_model",
    {
      title: "Turn a model in quarter turns",
      description:
        "Turns a model a quarter turn (or two or three) about the stock's X, Y or Z axis, as the app's turn buttons do, keeping its anchor point in place: for example to stand up a model exported lying on its side. Each turn is counter-clockwise looking from the axis's positive end towards the origin (right-hand rule): about Z, X turns into Y; about X, Y turns into Z; about Y, Z turns into X. Several turns make one change. Returns the project summary, with the model's new size.",
      inputSchema: {
        path: projectPath,
        id: itemId,
        axis: z.enum(["x", "y", "z"]).describe("The stock axis to turn about."),
        turns: z.number().int().min(1).max(3).default(1).describe("How many quarter turns."),
      },
    },
    ({ path, id, axis, turns }) =>
      respond(async () => {
        const project = await projects.get(path);
        turn(project, id, axis, turns);
        return summary(project);
      }),
  );

  const mm = (what: string) => z.number().positive().describe(`${what}, in millimetres.`);

  server.registerTool(
    "set_stock",
    {
      title: "Set the stock and units",
      description:
        "Sets the stock's width (X), height (Y) and thickness (Z) in millimetres, and the units the app shows (mm or in; lengths are given in millimetres either way), as the app's stock fields do. An anchored zero follows the stock, and the design stays aligned to it. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        units: z.enum(["mm", "in"]).optional().describe("The units the app shows."),
        width: mm("The stock's size along X").optional(),
        height: mm("The stock's size along Y").optional(),
        thickness: mm("The stock's thickness").optional(),
      },
    },
    ({ path, ...stock }) =>
      respond(async () => {
        const project = await projects.get(path);
        setStock(project, stock);
        return summary(project);
      }),
  );

  server.registerTool(
    "set_zero",
    {
      title: "Set the zero",
      description:
        "Sets where the machine's zero is. XY: a stock anchor (a corner, an edge's middle or the centre), which follows the stock and aligns the design to the stock there; or a custom point in millimetres from the stock's bottom-left corner, which may lie off the stock (a fence corner), where the design stays put. Z: the stock top or the machine bed. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        xy: z
          .union([
            StockAnchor,
            z
              .tuple([z.number(), z.number()])
              .describe("[x, y] in millimetres from the stock's bottom-left corner."),
          ])
          .optional(),
        z: z.enum(["stock_top", "machine_bed"]).optional(),
      },
    },
    ({ path, xy, z }) =>
      respond(async () => {
        const project = await projects.get(path);
        setZero(project, { xy, z });
        return summary(project);
      }),
  );

  server.registerTool(
    "set_touch_off_pad",
    {
      title: "Add, move or remove the touch-off pad",
      description:
        "The touch-off pad is a spot of the stock top no operation cuts, for zeroing Z on after a tool change. pad: true adds it (centred on the XY zero, unless x and y are given) and sets its centre and diameter; pad: false removes it. Lengths in millimetres, the centre from the stock's bottom-left corner; the diameter can't be wider than the stock's smaller side. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        pad: z.boolean(),
        x: z.number().optional().describe("The pad's centre along X, in millimetres."),
        y: z.number().optional().describe("The pad's centre along Y, in millimetres."),
        diameter: mm("The pad's diameter").optional(),
      },
    },
    ({ path, ...pad }) =>
      respond(async () => {
        const project = await projects.get(path);
        setTouchOff(project, pad);
        return summary(project);
      }),
  );

  server.registerTool(
    "set_two_sided",
    {
      title: "Set up a two-sided project",
      description:
        "Makes the project two-sided (the stock is cut from the top, turned over about a line through its centre along the flip axis, and cut from the other face) and sets it up, as the app's two-sided settings do; settings left out stay as they are. Turning it on flips about x, parting halfway down the deepest model. twoSided: false makes it one-sided again and moves every operation to the top side. lineUp: pins (positions along the flip axis from the stock's centre, two at least; a drill operation with pins cuts them), edges (a stock corner goes into a fence corner on both sides), or null to turn it over by eye. tabs: holding tabs that keep the part held on the bottom side, spread round each model (count per model) or at positions moved to the nearest model's outline; null removes them. Lengths in millimetres. Refused as a whole if any setting is. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        twoSided: z.boolean(),
        flipAxis: FlipAxis.optional().describe("The axis the stock is turned over about."),
        partingDepth: mm("How far below the stock top the sides part").optional(),
        lineUp: z
          .discriminatedUnion("type", [
            z.strictObject({ type: z.literal("edges"), corner: StockCorner }),
            z.strictObject({
              type: z.literal("pins"),
              diameter: mm("The pins' diameter").optional(),
              positions: z
                .array(z.number())
                .optional()
                .describe(
                  "Each pin's distance along the flip axis from the stock's centre, in millimetres.",
                ),
              holes: PinHoles.optional().describe(
                "through: through the stock and spoilboardDepth into the spoilboard; blind: depth below the stock top.",
              ),
            }),
          ])
          .nullable()
          .optional(),
        tabs: z
          .strictObject({
            width: mm("The tabs' width").optional(),
            thickness: mm("The tabs' thickness, less than the bottom side's depth").optional(),
            count: z.number().int().min(1).optional().describe("Tabs spread round each model."),
            positions: z
              .array(z.tuple([z.number(), z.number()]))
              .optional()
              .describe("[x, y] in millimetres from the stock's bottom-left corner, one per tab."),
          })
          .nullable()
          .optional(),
      },
    },
    ({ path, ...request }) =>
      respond(async () => {
        const project = await projects.get(path);
        setTwoSidedSetup(project, request);
        return summary(project);
      }),
  );

  server.registerTool(
    "get_library",
    {
      title: "List the tool library and machines",
      description:
        "Lists the desktop app's tool library (bits, with all their settings: lengths in millimetres, feed and plunge rates in mm/min, spindle speed in rpm, angles in degrees) and its machines, each with the id other tools take, and any problem reading them. Files the app hasn't written yet are reported, not an error.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => respond(() => readLibrary(library)),
  );

  server.registerTool(
    "set_machine",
    {
      title: "Choose the project's machine",
      description:
        "Copies a machine from the desktop app's machine list into the project, as choosing it in the app does: the project keeps its copy if the list changes. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        machineId: z.string().describe("The machine's id, from get_library."),
      },
    },
    ({ path, machineId }) =>
      respond(async () => {
        const project = await projects.get(path);
        chooseMachine(project, await readLibrary(library), machineId);
        return summary(project);
      }),
  );

  server.registerTool(
    "set_operation_tool",
    {
      title: "Set an operation's tool",
      description: `Gives an operation a copy of a tool, as picking a bit in the app does: from the desktop app's library by toolId, or from settings, which are checked as the app checks a tool. Settings: name; type (flat_end_mill, ball_end_mill, tapered_ball_end_mill, v_bit or drill); diameter (left out for tapered ball end mills: worked out from tipDiameter, taperAngle and fluteLength), fluteLength, stepDown (depth per pass) and tipDiameter (V-bits' flat, tapered ball end mills' ball, else null) in millimetres; fluteCount; cutDirection (upcut, downcut or compression for end mills, else null); vAngle (V-bits' included angle in degrees, else null); taperAngle (tapered ball end mills' angle per side in degrees, else null or left out); spindleRpm; feedRate and plungeRate in mm/min; plungeAngle in degrees (1 to 90, 90 plunges straight down, drills always 90); notes (or null); color (#rrggbb). A tool that can't cut the operation is refused with the app's message. Returns the project summary.`,
      inputSchema: {
        path: projectPath,
        operationId: z.string().describe("The operation's id, from the project summary."),
        toolId: z.string().optional().describe("A library tool's id, from get_library."),
        settings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("The tool's settings, instead of toolId."),
      },
    },
    ({ path, operationId, toolId, settings }) =>
      respond(async () => {
        const project = await projects.get(path);
        // Settings need no library.
        const tools =
          toolId === undefined
            ? { tools: [], machines: [], problems: [] }
            : await readLibrary(library);
        setToolOf(project, tools, operationId, { toolId, settings });
        return summary(project);
      }),
  );

  const operationId = z.string().describe("The operation's id, from the project summary.");
  const targets = z
    .array(
      z.union([
        z.strictObject({ drawingId: z.string().describe("A drawing's id: all its shapes.") }),
        z.strictObject({
          shapeId: z.string().describe("A shape's id, from the project summary."),
          paths: z
            .array(z.int().nonnegative())
            .optional()
            .describe("Indices of the shape's paths to cut; all of them if left out."),
        }),
      ]),
    )
    .describe("What it cuts: whole drawings, shapes, or some of a shape's paths.");
  const toolInput = {
    toolId: z.string().optional().describe("A library tool's id, from get_library."),
    tool: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "The tool's settings, instead of toolId: the settings set_operation_tool describes.",
      ),
  };
  const common = {
    path: projectPath,
    ...toolInput,
    name: z.string().optional().describe('Its name; the app\'s, e.g. "Profile 2", if left out.'),
    stockSide: z
      .enum(["top", "bottom"])
      .optional()
      .describe("The side of a two-sided project it cuts; the top if left out."),
  };
  const settings = (what: string) =>
    z
      .record(z.string(), z.unknown())
      .optional()
      .describe(`Settings to change from the defaults, any of: ${what}`);

  const POINTS =
    "[[x, y], …] in millimetres in stock coordinates ((0, 0) is the stock's bottom-left corner, as in the summary's bounds)";
  const DEPTH = "millimetres below the stock top";
  const DIRECTION = "direction: climb or conventional milling";
  const STEP_OVER =
    "stepOver: the distance between passes, as a percentage of the tool's diameter (over 0, up to 100)";
  const RAMP =
    "ramp: true to ramp into the cut at the tool's plunge angle, false to plunge straight down";
  const BOUNDARY =
    'boundary: what it covers: {type: "model"} (the model\'s outline), {type: "margin", distance} (the outline grown by distance millimetres) or {type: "stock"} (the whole stock)';
  const REST = "rest: true to cut only where earlier operations left material (rest machining)";

  const OPERATION_SETTINGS: Record<OperationType, string> = {
    profile: `side: outside, inside or on (follows the line); ${DIRECTION}; depth: final depth, ${DEPTH} (default: the stock's thickness, cutting through); allowance: millimetres the depth passes leave on the wall (0 when side is on); finishPass: true for one more lap at full depth removing the allowance (needs an allowance); leadIn: {radius} in millimetres, a tangent arc into each closed contour, or null; ${RAMP}; tabs: holding tabs that keep the part attached, null for none, or {count} per closed contour (or {spacing} in millimetres, or positions as ${POINTS}), with width (along the contour, default 6) and height (up from the final depth, default 3 but at most half the depth) in millimetres; startPoints: where cuts start, one per path, [{start: [x, y], plunge: null or [x, y]}, …] in millimetres in stock coordinates, each start moved to the nearest path; a plunge point (closed paths only, not with tabs) is where the tool goes straight down at every level, beside the part or in a pre-drilled hole, feeding straight to start and back after the lap, for cutters that can't plunge into stock; cornerOvercuts: dogbones at sharp inside corners so a square-edged part fits, {maxAngle: corners up to this many degrees get one (the app starts at 90), excluded: []}, or null (not with side on).`,
    pocket: `side: inside (clears inside the closed paths, leaving any islands), outside (clears the stock outside them up to its edge) or on (inside, the tool's centre reaching the paths); strategy: {type: "offset"} (rings from the centre out), {type: "linear", angle} (zig-zag passes at 0, 90, 45 or -45 degrees from X) or {type: "peel", start} (engagement-limited, from centre, inside or outside); ${DIRECTION}; ${STEP_OVER} (default 40); depth: final depth, ${DEPTH} (default half the stock); allowance: millimetres left on the walls and islands; finishPass: true for one more lap on each wall removing the allowance (needs an allowance); ${RAMP} (default true).`,
    drill: `depth: of the tool tip, ${DEPTH} (default: the stock's thickness); peck: true (default) to drill in pecks of the tool's step-down, retracting to clear chips; ${STEP_OVER}, for an end mill boring a hole wider than itself in rings (default 40); points: holes placed at ${POINTS}, which need no shapes; pins: true to drill a two-sided project's locating pins instead of shapes and points (top side only). It drills single-point paths and circles; a drill bit drills circles of its own diameter.`,
    engrave: `side: on (default, the groove centred on the line), inside or outside (an edge of the groove on the line, for closed paths), or chamfer (V-bits only: bevels the closed paths' edges, inward on outer contours and outward on holes); depth: of the tool tip, ${DEPTH} (default 1, or the stock's thickness if thinner; with a V-bit it sets the line's width; a chamfer ignores it); width: the chamfer's width on the stock top, in mm (only with side chamfer; default 1, or the cone's if narrower; null on other sides, which changing the side sets); ${RAMP}; startPoints: where cuts start, ${POINTS}.`,
    vcarve: `maxDepth: the deepest the V-bit goes, ${DEPTH} (default: the bit's cone depth, at most half the stock); flatBottom: where the shape is wider than the bit reaches at maxDepth, a flat end mill clears the floor flat first: {toolId} or {tool: settings as for tool}, with stepOver (percentage of its diameter, default 40), or null for none (default).`,
    relief_rough: `strategy: {type: "offset"}, {type: "linear", angle} (0, 90, 45 or -45 degrees from X) or {type: "peel", start} (centre or outside); ${DIRECTION}; ${STEP_OVER} (default 40); stockToLeave: millimetres left on the model everywhere for finishing (default 0.5); ${BOUNDARY} (default model); ${RAMP} (default true); ${REST}.`,
    relief_finish: `strategy: {type: "parallel", angle, direction} (straight passes at angle degrees from X, 0 up to but not 180, direction one_way or zigzag; the default, 0 and zigzag), {type: "waterline", stepDown} (contours at constant height, stepDown millimetres apart) or {type: "spiral", start} (outside or centre); ${STEP_OVER}, between parallel passes or spiral laps (default 10); stockToLeave: millimetres left on the model (default 0); ${BOUNDARY} (default model); ${REST}.`,
  };

  const ADD_TOOLS: [OperationType, string, string, "targets" | "model"][] = [
    [
      "profile",
      "Add a profile",
      "Cuts along the shapes' lines, outside, inside or on them: to cut parts out or trim them to size.",
      "targets",
    ],
    [
      "pocket",
      "Add a pocket",
      "Clears the area inside the shapes' closed paths to a depth, leaving islands standing, or the stock around them.",
      "targets",
    ],
    [
      "drill",
      "Add a drill operation",
      "Drills holes at the shapes' points and circles, at placed points, or the locating pins of a two-sided project.",
      "targets",
    ],
    [
      "engrave",
      "Add an engraving",
      "Follows the shapes' paths at a shallow depth: lettering, lines and decoration, with an end mill or a V-bit.",
      "targets",
    ],
    [
      "vcarve",
      "Add a V-carve",
      "Carves the inside of the shapes' closed paths with a V-bit, as deep as the bit needs to reach the edges: sharp-cornered lettering and signs. Only V-bits V-carve.",
      "targets",
    ],
    [
      "relief_rough",
      "Add 3D roughing",
      "Clears the material above a 3D model in levels, leaving stock for finishing.",
      "model",
    ],
    [
      "relief_finish",
      "Add 3D finishing",
      "Runs the tool over a 3D model's surface, usually a ball end mill after roughing.",
      "model",
    ],
  ];

  type AddInput = { path: string; toolId?: string; tool?: Record<string, unknown> } & Omit<
    NewOperation,
    "tool"
  >;

  for (const [type, title, what, on] of ADD_TOOLS) {
    server.registerTool(
      `add_${type}`,
      {
        title,
        description: `${what} Adds it at the end of the cutting order with the app's defaults and a copy of the tool (from the library by toolId, or from its settings), then changes any settings given; anything the app refuses is refused, with its message, and nothing changes. Lengths in millimetres. Returns the new operation's id and the project summary.`,
        inputSchema: {
          ...common,
          ...(on === "targets"
            ? { targets: type === "drill" ? targets.optional() : targets }
            : { modelId: z.string().describe("The model's id, from the project summary.") }),
          settings: settings(OPERATION_SETTINGS[type]),
        },
      },
      ({ path, toolId, tool, ...input }: AddInput) =>
        respond(async () => {
          const project = await projects.get(path);
          // Read even for a tool given by its settings: a V-carve's flat bottom may name a library tool.
          const id = addOperation(project, await readLibrary(library), type, {
            ...input,
            tool: { toolId, settings: tool },
          });
          return { id, ...summary(project) };
        }),
    );
  }

  server.registerTool(
    "edit_operation",
    {
      title: "Edit an operation",
      description: `Renames an operation, enables or disables it (a disabled one isn't cut or exported), changes what it cuts, and changes some of its settings, as the app's properties do: all of it, or, if the app refuses any of it, nothing, with the app's message. Settings have the names and meanings the add tool of the operation's type gives them (add_profile, add_pocket, add_drill, add_engrave, add_vcarve, add_relief_rough, add_relief_finish). Its tool is changed with set_operation_tool. Returns the project summary.`,
      inputSchema: {
        path: projectPath,
        operationId,
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        targets: targets.optional().describe("What a 2D operation cuts, replacing its targets."),
        settings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Settings to change, by the names above for the operation's type."),
      },
    },
    ({ path, operationId, ...edit }) =>
      respond(async () => {
        const project = await projects.get(path);
        editOperation(project, await readLibrary(library), operationId, edit);
        return summary(project);
      }),
  );

  server.registerTool(
    "move_operation",
    {
      title: "Move an operation in the cutting order",
      description:
        "Moves an operation to another place in the cutting order, as dragging it in the app's list does: index 0 cuts first; an index past the end moves it last. Returns the project summary.",
      inputSchema: {
        path: projectPath,
        operationId,
        index: z.int().nonnegative().describe("Its new place, from 0."),
      },
    },
    ({ path, operationId, index }) =>
      respond(async () => {
        const project = await projects.get(path);
        moveTo(project, operationId, index);
        return summary(project);
      }),
  );

  server.registerTool(
    "remove_operation",
    {
      title: "Remove an operation",
      description:
        "Removes an operation from the project. The user can restore it from the automatic version kept before the assistant's first change. Returns the project summary.",
      inputSchema: { path: projectPath, operationId },
      annotations: { destructiveHint: true },
    },
    ({ path, operationId }) =>
      respond(async () => {
        const project = await projects.get(path);
        removeOperation(project, operationId);
        return summary(project);
      }),
  );

  return server;
}
