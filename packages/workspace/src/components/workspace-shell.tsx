"use client";

import { Button } from "@furrow/ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@furrow/ui/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@furrow/ui/components/ui/tabs";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";
import { lazy, useRef, useState } from "react";
import type { Layout, LayoutChangedMeta } from "react-resizable-panels";
import { useTranslations } from "use-intl";
import { useSaveStatus } from "../hooks/use-autosave";
import { useSelectedDrawingId } from "../hooks/use-selected-drawing";
import { useUndoShortcuts } from "../hooks/use-undo-shortcuts";
import { savedLayout } from "../lib/workspace-layout";
import { Tour, useTour } from "../onboarding/components/tour";
import type { TourPane } from "../onboarding/lib/tour";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../providers/workspace-stores";
import { BrowserOnly } from "./browser-only";
import { DrawingProperties } from "./drawing-properties";
import { ExportProjectButton } from "./export-project-button";
import { GcodeExportButton } from "./gcode-export-button";
import { GeometryImport } from "./geometry-import";
import { ModelProperties } from "./model-properties";
import { OperationProperties } from "./operation-properties";
import { OperationsPane } from "./operations-pane";
import { SimulateButton } from "./simulate-button";
import { StockProperties } from "./stock-properties";
import { ToolpathProgressToast } from "./toolpath-progress-toast";
import { TopBar } from "./top-bar";
import { VersionsButton } from "./versions-pane";

/** WebGL needs the browser (ADR-0008), so the viewport never renders on the server. */
const Viewport = lazy(() =>
  import("./viewport/viewport").then((m) => ({
    default: m.Viewport,
  })),
);

/**
 * The CAM workspace (ADR-0009): a top bar, with the project's versions
 * (ADR-0028), over two resizable columns: the operations and the project's
 * properties in tabs on the left, the viewport on the right, with the
 * selected operation's properties floating over it. Column sizes are
 * remembered by the host (`settings.layout`). The project and its
 * stores come from `ProjectShell`, so they outlive this page.
 */
export function WorkspaceShell() {
  const t = useTranslations("Shell");
  const { project, library, settings, account } = useWorkspaceHost();
  const saveStatus = useSaveStatus();
  const machineName = useDocumentStore((s) => s.document.machine?.name ?? null);
  const hasEnabledOperations = useDocumentStore((s) =>
    s.document.operations.some((operation) => operation.enabled),
  );
  useUndoShortcuts();
  const tour = useTour("workspace", {
    userId: settings.account,
    done: settings.tourDone,
    autoStart: true,
    finish: settings.finishTour,
  });
  const documentStore = useDocumentStoreApi();
  const getDocument = () => documentStore.getState().document;
  const [tab, setTab] = useState<string>("operations");
  const [layout] = useState(() => settings.layout);
  const saved = useRef(layout);

  function remember(sizes: Layout, meta: LayoutChangedMeta) {
    // Window resizes and the initial mount aren't a choice worth keeping.
    if (!meta.isUserInteraction) return;
    saved.current = { ...saved.current, columns: sizes };
    settings.saveLayout(saved.current);
  }

  return (
    <>
      <TopBar
        saveStatus={saveStatus}
        machineName={machineName}
        onTakeTour={(from) => tour.start(from)}
      >
        <VersionsButton />
      </TopBar>
      <Tour
        id="workspace"
        running={tour.running}
        origin={tour.origin}
        onEnd={tour.end}
        revealPane={setTab}
      />
      {saveStatus.state === "failed" && <SaveFailed message={saveStatus.error} />}
      {saveStatus.state === "error" && <SaveError message={saveStatus.error} />}
      {/* Below the panels' minimum widths (200 + 200px), scroll sideways instead of clipping them. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-100"
          defaultLayout={savedLayout(layout.columns, ["sidebar", "viewport"])}
          onLayoutChanged={remember}
        >
          <ResizablePanel
            id="sidebar"
            defaultSize={300}
            minSize={200}
            maxSize="50%"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
          >
            <Tabs value={tab} onValueChange={setTab} className="h-full">
              <TabsList>
                <TabsTrigger value="operations">{t("operations")}</TabsTrigger>
                <TabsTrigger value="properties">{t("properties")}</TabsTrigger>
              </TabsList>
              <SidebarTab
                id="operations"
                footer={
                  <div className="flex gap-2">
                    <div data-tour="export-gcode" className="min-w-0 flex-1">
                      <GcodeExportButton
                        name={project.name}
                        disabledReason={
                          // Without an account, the button explains what it needs instead.
                          machineName === null && !account
                            ? t("chooseMachine")
                            : !hasEnabledOperations
                              ? t("addOperation")
                              : undefined
                        }
                        className="w-full"
                      />
                    </div>
                    <SimulateButton
                      disabledReason={hasEnabledOperations ? undefined : t("addOperation")}
                    />
                  </div>
                }
              >
                <OperationsPane />
              </SidebarTab>
              <SidebarTab
                id="properties"
                footer={<ExportProjectButton getDocument={getDocument} className="w-full" />}
              >
                <StockProperties machines={library.machines} />
              </SidebarTab>
            </Tabs>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="viewport" minSize={200}>
            <section
              aria-label={t("viewport")}
              data-tour="viewport"
              className="relative h-full bg-muted/40"
            >
              <BrowserOnly
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <EmptyState>{t("loadingViewport")}</EmptyState>
                  </div>
                }
              >
                <Viewport />
              </BrowserOnly>
              <GeometryImport />
              <ToolpathProgressToast />
              <SelectedOperation />
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}

/**
 * The selected operation's properties, the selected model's placement or
 * the size of the drawing the selected paths belong to, in that order, in a
 * panel floating over the viewport's top right corner, so the project's
 * stock stays in the Properties pane.
 */
function SelectedOperation() {
  const selectedId = useWorkspaceStore((s) => s.selectedOperationId);
  const modelId = useWorkspaceStore((s) => s.selectedModelId);
  const drawingId = useSelectedDrawingId();
  const t = useTranslations("Shell");
  if (selectedId === null && modelId === null && drawingId === null) return null;
  return (
    <aside
      aria-label={
        selectedId !== null
          ? t("operationProperties")
          : modelId !== null
            ? t("modelProperties")
            : t("drawingProperties")
      }
      className="absolute top-2 right-2 z-10 max-h-[calc(100%-1rem)] w-80 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border bg-background/85 shadow-xs backdrop-blur-md"
    >
      {/* Keyed, so nothing typed or rejected for one operation or model shows on the next. */}
      {selectedId !== null ? (
        <OperationProperties key={selectedId} operationId={selectedId} />
      ) : modelId !== null ? (
        <ModelProperties key={modelId} modelId={modelId} />
      ) : (
        drawingId !== null && <DrawingProperties key={drawingId} drawingId={drawingId} />
      )}
    </aside>
  );
}

/** Autosave stopped for good (e.g. a conflict): say so where it can't be missed. */
function SaveFailed({ message }: { message: Translatable | undefined }) {
  const t = useTranslations("Shell");
  const format = useFormatMessage();
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-ui text-destructive"
    >
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {t("saveFailed", { message: message === undefined ? "" : format(message) })}
      </p>
      <Button variant="outline" size="compact" onClick={() => window.location.reload()}>
        {t("reload")}
      </Button>
    </div>
  );
}

/** A save failed but autosave tries again (e.g. signed out): say why, so the user can fix it. */
function SaveError({ message }: { message: Translatable | undefined }) {
  const t = useTranslations("Shell");
  const format = useFormatMessage();
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-ui text-destructive"
    >
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {t("saveError", { message: message === undefined ? "" : format(message) })}
      </p>
    </div>
  );
}

/**
 * A sidebar tab's content: `footer` stays at its bottom while the rest
 * scrolls. Hidden rather than unmounted while another tab shows, so it keeps
 * its state and running actions.
 */
function SidebarTab({
  id,
  footer,
  children,
}: {
  id: TourPane;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("Shell");
  return (
    <TabsContent
      value={id}
      forceMount
      aria-label={t(id)}
      data-tour={id}
      className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
    >
      {/* Relative, so absolute content (`sr-only` inputs) scrolls with it instead of growing the page. */}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      <div className="shrink-0 border-t p-2">{footer}</div>
    </TabsContent>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-ui text-muted-foreground">{children}</p>;
}
