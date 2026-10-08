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
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  stepDown: 2,
  stepOver: 40,
  notes: null,
});

export async function createDefaultTool(userId: string): Promise<void> {
  await db.tool.create({ data: { ...DEFAULT_TOOL, userId } });
}
