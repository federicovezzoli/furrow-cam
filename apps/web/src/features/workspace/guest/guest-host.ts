import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import type { Settings } from "@furrow/workspace/lib/local-library";
import type { ToolChoice, WorkspaceHost } from "@furrow/workspace/lib/workspace-host";
import {
  deleteGuestMesh,
  type GuestProject,
  getGuestMesh,
  putGuestMesh,
  saveGuestProject,
  saveGuestSettings,
  saveGuestTool,
} from "./storage";

/**
 * The guest's settings as last saved, shared by the hosts of every project
 * the guest opens in this page, so a tour finished in one isn't shown again in the next.
 */
export type GuestSettings = { current: Settings };

/** The guest's own bits as last saved, shared the same way. */
export type GuestTools = { current: ToolChoice[] };

/**
 * The workspace host of a guest's `project` (ADR-0050): it saves the
 * project and the guest's own `tools` to the browser's storage, and has no
 * versions and no machines; the workspace adds the bit catalog. `navigation`
 * is the guest app's, and `account` explains what needs an account
 * (PRD-0008 G6).
 */
export function guestHost(
  project: GuestProject,
  settings: GuestSettings,
  tools: GuestTools,
  navigation: WorkspaceHost["navigation"],
  account: NonNullable<WorkspaceHost["account"]>,
): WorkspaceHost {
  const { id } = project;
  return {
    project: {
      id,
      name: project.name,
      document: project.document,
      savedAt: project.savedAt,
      autosaves: true,
      save: (document, savedAt) => saveGuestProject(id, document, savedAt),
    },
    meshes: {
      async put(sha256, file) {
        try {
          return await putGuestMesh(id, sha256, file);
        } catch (error) {
          return { error: (error as Error).message };
        }
      },
      get: (sha256) => getGuestMesh(id, sha256),
      discard: (sha256) => deleteGuestMesh(id, sha256),
    },
    versions: null,
    library: {
      tools: tools.current,
      machines: [],
      async saveTool(toolId, form) {
        let result: Awaited<ReturnType<typeof saveGuestTool>>;
        try {
          result = await saveGuestTool(toolId, form);
        } catch (error) {
          return { errors: { form: (error as Error).message } };
        }
        if ("errors" in result) return result;
        tools.current = result.tools;
        return result.saved;
      },
    },
    settings: {
      account: "guest",
      tourDone: settings.current.workspaceTourDone,
      async finishTour() {
        settings.current = { ...settings.current, workspaceTourDone: true };
        await saveGuestSettings(settings.current).catch(() => {});
      },
      get layout() {
        return settings.current.workspaceLayout;
      },
      saveLayout(workspaceLayout) {
        settings.current = { ...settings.current, workspaceLayout };
        // Panel sizes aren't worth an error; the next change tries again.
        saveGuestSettings(settings.current).catch(() => {});
      },
    },
    navigation,
    account,
    limits: { meshes: DEFAULT_STL_LIMITS },
  };
}
