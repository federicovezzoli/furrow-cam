import type { Message } from "@furrow/document";
import { Machine, Tool, upgradeMachine } from "@furrow/document";
import { type MachineFormErrors, parseMachineForm } from "../machines/lib/machine-form-data";
import { DEFAULT_TOOL, parseToolForm } from "../tools/lib/tool-form-data";
import type { MachineChoice, SavedTool, ToolChoice, ToolFormErrors } from "./workspace-host";
import { toWorkspaceLayout, type WorkspaceLayout } from "./workspace-layout";

/**
 * A tool library, machine list and settings kept on the user's device rather
 * than in an account: the desktop app's (PRD-0007 D9, stored as JSON files,
 * ADR-0047) and the web app's guest workspace's (PRD-0008, in the browser,
 * ADR-0050). Entries are checked with the document's schemas when read; ones
 * that fail today's rules are left out, as in the web app. These functions
 * return new lists for the app to store.
 */

const byToolName = (a: ToolChoice, b: ToolChoice) => a.tool.name.localeCompare(b.tool.name);
const byMachineName = (a: MachineChoice, b: MachineChoice) =>
  a.machine.name.localeCompare(b.machine.name);

/**
 * The tools stored as `json`. A library never stored (the first start) holds
 * the web app's default bit, so a first project can be cut straight away.
 */
export function parseTools(json: unknown): ToolChoice[] {
  if (json === null || json === undefined) {
    return [{ id: crypto.randomUUID(), isDefault: true, tool: DEFAULT_TOOL }];
  }
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { id, isDefault, tool } = entry as Record<string, unknown>;
      const parsed = Tool.safeParse(tool);
      return typeof id === "string" && parsed.success
        ? [{ id, isDefault: isDefault === true, tool: parsed.data }]
        : [];
    })
    .sort(byToolName);
}

export function parseMachines(json: unknown): MachineChoice[] {
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { id, machine } = entry as Record<string, unknown>;
      const parsed = Machine.safeParse(upgradeMachine(machine));
      return typeof id === "string" && parsed.success ? [{ id, machine: parsed.data }] : [];
    })
    .sort(byMachineName);
}

/**
 * Saves the tool form as tool `id`, or a new tool when `null`; a library's
 * first tool becomes its default.
 */
export function saveTool(
  tools: readonly ToolChoice[],
  id: string | null,
  form: FormData,
): { tools: ToolChoice[]; saved: SavedTool } | { errors: ToolFormErrors } {
  const parsed = parseToolForm(form);
  if (parsed.errors) return { errors: parsed.errors };
  const { tool } = parsed;
  if (id === null) {
    const added = { id: crypto.randomUUID(), isDefault: tools.length === 0, tool };
    return { tools: [...tools, added].sort(byToolName), saved: { id: added.id, tool } };
  }
  if (!tools.some((choice) => choice.id === id)) {
    return { errors: { form: { code: "workspace.bitNotFound" } } };
  }
  return {
    tools: tools
      .map((choice) => (choice.id === id ? { ...choice, tool } : choice))
      .sort(byToolName),
    saved: { id, tool },
  };
}

/** Deletes tool `id`; deleting the default makes the first remaining tool the default. */
export function deleteTool(tools: readonly ToolChoice[], id: string): ToolChoice[] {
  const deleted = tools.find((choice) => choice.id === id);
  const rest = tools.filter((choice) => choice.id !== id);
  if (!deleted?.isDefault || rest.length === 0) return rest;
  const [first, ...others] = rest as [ToolChoice, ...ToolChoice[]];
  return [{ ...first, isDefault: true }, ...others];
}

export function setDefaultTool(tools: readonly ToolChoice[], id: string): ToolChoice[] {
  return tools.map((choice) => ({ ...choice, isDefault: choice.id === id }));
}

/** Saves the machine form as machine `id`, or a new machine when `null`. */
export function saveMachine(
  machines: readonly MachineChoice[],
  id: string | null,
  form: FormData,
): { machines: MachineChoice[] } | { errors: MachineFormErrors } {
  const parsed = parseMachineForm(form);
  if (parsed.errors) return { errors: parsed.errors };
  const { machine } = parsed;
  if (id === null) {
    return { machines: [...machines, { id: crypto.randomUUID(), machine }].sort(byMachineName) };
  }
  if (!machines.some((choice) => choice.id === id)) {
    return { errors: { form: { code: "workspace.machineNotFound" } } };
  }
  return {
    machines: machines
      .map((choice) => (choice.id === id ? { ...choice, machine } : choice))
      .sort(byMachineName),
  };
}

/** Deletes machine `id`; projects keep their own snapshot of it (ADR-0003). */
export function deleteMachine(machines: readonly MachineChoice[], id: string): MachineChoice[] {
  return machines.filter((choice) => choice.id !== id);
}

/** Per-computer settings: which tours were seen, and the workspace's panel sizes. */
export type Settings = { workspaceTourDone: boolean; workspaceLayout: WorkspaceLayout };

export function parseSettings(json: unknown): Settings {
  const stored = typeof json === "object" && json !== null ? json : {};
  return {
    workspaceTourDone: "workspaceTourDone" in stored && stored.workspaceTourDone === true,
    workspaceLayout: toWorkspaceLayout(
      "workspaceLayout" in stored ? stored.workspaceLayout : undefined,
    ),
  };
}

/** `error`'s message for the user. */
export function messageOf(error: unknown): string | Message {
  return error instanceof Error ? error.message : { code: "workspace.somethingWrong" };
}
