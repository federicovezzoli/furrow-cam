"use client";

import dynamic from "next/dynamic";
import { useSaveStatus } from "@/features/workspace/hooks/use-autosave";
import { useDocumentStore } from "@/features/workspace/providers/workspace-stores";
import { useOpenProject } from "./project-shell";
import { TopBar } from "./top-bar";

/** WebGL needs the browser (ADR-0008), so the viewport never renders on the server. */
const SimulatorViewport = dynamic(
  () =>
    import("@/features/workspace/components/viewport/simulator-viewport").then(
      (m) => m.SimulatorViewport,
    ),
  {
    ssr: false,
    loading: () => <p className="m-auto p-3 text-ui text-muted-foreground">Loading simulator…</p>,
  },
);

/**
 * The project's simulator (ADR-0042), on its own page so the workspace stays
 * about setting up the cut: the stock cut move by move as the tool plays the
 * toolpaths back, with a timeline, and a way back to the workspace. The
 * project, its stores and toolpaths come from `ProjectShell`, so they
 * survive going back and forth.
 */
export function SimulatorShell() {
  const { project } = useOpenProject();
  const saveStatus = useSaveStatus();
  const machineName = useDocumentStore((s) => s.document.machine?.name ?? null);
  return (
    <>
      <TopBar
        project={project}
        saveStatus={saveStatus}
        machineName={machineName}
        back={{ href: `/projects/${project.id}`, label: "Back to the workspace" }}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        <SimulatorViewport />
      </main>
    </>
  );
}
