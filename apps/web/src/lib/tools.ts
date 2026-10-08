import { Tool } from "@furrow/document";
import { db } from "@/lib/db";

/** The signed-in user's tool library, by name. */
export function listTools(userId: string) {
  return db.tool.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

/** One of the user's tools, or `null` if it doesn't exist or belongs to someone else. */
export function getTool(userId: string, id: string) {
  return db.tool.findFirst({ where: { id, userId } });
}

/**
 * Copies a library tool into the shape stored in an operation (ADR-0003). The
 * snapshot keeps no link to the row, so editing or deleting the tool later
 * never changes existing projects.
 */
export function snapshotTool(row: Tool): Tool {
  return Tool.parse(row);
}

/** Picked in turn for new tools, so each one is told apart in the preview without choosing a colour. */
export const TOOL_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
] as const;

/** The first palette colour no tool uses yet, cycling once all are taken. */
export function nextToolColor(tools: { color: string }[]): string {
  const used = new Set(tools.map((tool) => tool.color));
  return (
    TOOL_COLORS.find((color) => !used.has(color)) ?? TOOL_COLORS[tools.length % TOOL_COLORS.length]
  );
}

/** Seeded into every new account, so a first project can be cut without setting up a library. */
export const DEFAULT_TOOL: Tool = Tool.parse({
  name: "6 mm 2-flute upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: TOOL_COLORS[0],
});

/** Seeds the account's library with `DEFAULT_TOOL`, selected as the default tool. */
export async function createDefaultTool(userId: string): Promise<void> {
  await db.tool.create({ data: { ...DEFAULT_TOOL, userId, isDefault: true } });
}
