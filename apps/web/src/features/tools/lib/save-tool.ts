import { createTool, updateTool } from "@/features/tools/actions";
import type { SaveTool } from "@/features/tools/components/tool-form";

/** Saves a tool form to the signed-in user's library on the server. */
export const saveTool: SaveTool = (id, form) =>
  id === null ? createTool(form) : updateTool(id, form);
