import { SimulatorShell } from "@furrow/workspace/components/simulator-shell";

// The layout holds this page back until the project loads; "Loading project…" is its instant UI.
export const instant = false;

/** The project's simulator; the layout loads the project and holds its stores. */
export default function SimulatePage() {
  return <SimulatorShell />;
}
