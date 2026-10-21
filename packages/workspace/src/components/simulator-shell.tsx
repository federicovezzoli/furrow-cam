"use client";

import { lazy } from "react";
import { useTranslations } from "use-intl";
import { useSaveStatus } from "../hooks/use-autosave";
import { useDocumentStore } from "../providers/workspace-stores";
import { BrowserOnly } from "./browser-only";
import { TopBar } from "./top-bar";

/** WebGL needs the browser (ADR-0008), so the viewport never renders on the server. */
const SimulatorViewport = lazy(() =>
  import("./viewport/simulator-viewport").then((m) => ({
    default: m.SimulatorViewport,
  })),
);

/**
 * The project's simulator (ADR-0042), on its own page so the workspace stays
 * about setting up the cut: the stock cut move by move as the tool plays the
 * toolpaths back, with a timeline, and a way back to the workspace. The
 * project, its stores and toolpaths come from `ProjectShell`, so they
 * survive going back and forth.
 */
export function SimulatorShell() {
  const saveStatus = useSaveStatus();
  const machineName = useDocumentStore((s) => s.document.machine?.name ?? null);
  const t = useTranslations("Shell");
  return (
    <>
      <TopBar
        saveStatus={saveStatus}
        machineName={machineName}
        back={{ to: "workspace", label: t("backToWorkspace") }}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        <BrowserOnly
          fallback={
            <p className="m-auto p-3 text-ui text-muted-foreground">{t("loadingSimulator")}</p>
          }
        >
          <SimulatorViewport />
        </BrowserOnly>
      </main>
    </>
  );
}
