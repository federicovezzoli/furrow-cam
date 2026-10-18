import type { SaveTool } from "@furrow/workspace/tools/components/tool-form";
import { createTool, updateTool } from "@/features/tools/actions";

/** Saves a tool form to the signed-in user's library on the server. */
export const saveTool: SaveTool = (id, form) =>
  id === null ? createTool(form) : updateTool(id, form);
