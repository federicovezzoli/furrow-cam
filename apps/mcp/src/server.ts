import { MIN_LENGTH } from "@furrow/cam-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { fitToStock, importFile, resize } from "./drawings-and-models";
import { checkProject, exportProject, type Progress } from "./gcode";
import { createProjects, type Project, type Projects, ToolError } from "./projects";
import { projectSummary } from "./summary";

const projectPath = z
  .string()
  .describe(
    "Absolute path of the project file: .furrow, or .furrow.zip or .furrow.json to open one exported from the web app. It saves as .furrow next to it.",
  );

/** `run`'s result as JSON for the assistant, or its `ToolError` as a tool error. */
async function respond(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
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

/** The local MCP server (PRD-0012, ADR-0067), with no transport yet. */
export function createServer(projects: Projects = createProjects()) {
  const server = new McpServer({ name: "furrow-cam", version: packageJson.version });

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
        "Returns a project's summary: the path to call tools with, the .furrow file it saves to, units, stock and zero, machine, drawings with their shapes and bounds, 3D models, and operations in cutting order with all their settings. Lengths are in millimetres, feed rates in mm/min; the stock and zero are also given in the project's units.",
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
        "Saves a project's changes to its .furrow file, which the desktop app opens; changes stay in this server until saved. With saveAs, saves it to that path instead and keeps saving there. Never replaces another file, nor the project's own if it changed since it was opened (for example in the app). The first change since the project was opened is preceded by an automatic version (\"Before the assistant's changes\") the user can restore in the app.",
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
        "Computes a project's toolpaths and writes its G-code for the machine's post-processor, byte for byte what the app exports: one file named after the project (e.g. Sign.gcode), or one per side of a two-sided project (Sign-top.gcode, Sign-bottom.gcode). Writes next to the project's .furrow file unless given a folder. Never replaces a file unless overwrite is true. Saved or not, it exports the project as it is in this server. Returns the files written and the export's warnings. Never sends anything to a machine: the user loads and runs the G-code.",
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

  const itemId = z.string().describe("The drawing's or model's id, from the project summary.");

  server.registerTool(
    "import_file",
    {
      title: "Import a drawing or 3D model",
      description:
        "Imports an SVG or DXF drawing, or an STL 3D model, into a project, as the app does. A project holds drawings (several, each its own) or one model, not both. Drawings keep their size in the file and models are fitted inside the stock; both are placed at the zero's corner or centre, which fit_to_stock and resize can change. An SVG sized in pixels or not at all needs dpi, and a DXF that doesn't say its units needs units: without them the import is refused, saying so; ask the user rather than guessing. Returns the new drawing's or model's id, the import's warnings and the project summary.",
      inputSchema: {
        path: projectPath,
        file: z.string().describe("Absolute path of the .svg, .dxf or .stl file."),
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

  return server;
}
