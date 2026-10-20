import { WorkspaceShell } from "@furrow/workspace/components/workspace-shell";

// The layout holds this page back until the project loads; "Loading project…" is its instant UI.
export const instant = false;

/** The project's workspace; the layout loads the project and holds its stores. */
export default function WorkspacePage() {
  return <WorkspaceShell />;
}
