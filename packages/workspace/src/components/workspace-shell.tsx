"use client";

import { Button } from "@furrow/ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@furrow/ui/components/ui/resizable";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { cn } from "@furrow/ui/lib/utils";
import { ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import type * as React from "react";
import { lazy, useRef, useState } from "react";
import {
  type Layout,
  type LayoutChangedMeta,
  useGroupRef,
  usePanelRef,
} from "react-resizable-panels";
import { useTranslations } from "use-intl";
import { useSaveStatus } from "../hooks/use-autosave";
import { useSelectedDrawingId } from "../hooks/use-selected-drawing";
import { useUndoShortcuts } from "../hooks/use-undo-shortcuts";
import { savedLayout, toggledPaneLayout, type WorkspaceLayout } from "../lib/workspace-layout";
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
import { VersionsPane } from "./versions-pane";

/** WebGL needs the browser (ADR-0008), so the viewport never renders on the server. */
const Viewport = lazy(() =>
  import("./viewport/viewport").then((m) => ({
    default: m.Viewport,
  })),
);

/**
 * The CAM workspace (ADR-0009): a top bar over two resizable columns,
 * operations over the project's properties and its versions (ADR-0028) on
 * the left and the viewport on the right, with the selected operation's properties floating over it.
 * Panes collapse to their headers, each on its own; panel sizes are
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
  const sidebar = useGroupRef();
  const operationsPanel = usePanelRef();
  const propertiesPanel = usePanelRef();
  const versionsPanel = usePanelRef();
  const [layout] = useState(() => settings.layout);
  const saved = useRef(layout);
  const panes = {
    operations: operationsPanel,
    properties: propertiesPanel,
    versions: versionsPanel,
  };
  /** The size each pane had when last collapsed, to expand it back to (percent). */
  const openSizes = useRef({ operations: 35, properties: 45, versions: 20 });

  function remember(group: keyof WorkspaceLayout) {
    return (sizes: Layout, meta: LayoutChangedMeta) => {
      // Window resizes and the initial mount aren't a choice worth keeping.
      if (!meta.isUserInteraction) return;
      saved.current = { ...saved.current, [group]: sizes };
      settings.saveLayout(saved.current);
    };
  }

  /**
   * Collapses or expands pane `id` without opening or closing any other: with
   * every pane collapsed, the space below their headers is left empty. The
   * new layout is saved unless `persist` is false.
   */
  function toggle(id: keyof typeof panes, persist = true) {
    const group = sidebar.current;
    const panel = panes[id].current;
    if (!group || !panel) return;
    const layout = group.getLayout();
    const { inPixels, asPercentage } = panel.getSize();
    if (inPixels === 0) return;
    const percentPerPixel = asPercentage / inPixels;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const collapsed = new Set(
      Object.entries(panes).flatMap(([pane, ref]) => (ref.current?.isCollapsed() ? [pane] : [])),
    );
    if (!collapsed.has(id)) openSizes.current[id] = layout[id] ?? openSizes.current[id];
    const sizes = group.setLayout(
      toggledPaneLayout({
        layout,
        panes: Object.keys(panes),
        rest: SIDEBAR_REST,
        collapsed,
        target: id,
        headerSize: PANE_HEADER_REM * rem * percentPerPixel,
        openSize: openSizes.current[id],
        minSize: PANE_MIN_SIZE * percentPerPixel,
      }),
    );
    if (!persist) return;
    saved.current = { ...saved.current, sidebar: sizes };
    settings.saveLayout(saved.current);
  }

  /** Expands pane `id` for the tour's step inside it, leaving the saved layout as the user set it. */
  function reveal(id: TourPane) {
    if (panes[id].current?.isCollapsed()) toggle(id, false);
  }

  return (
    <>
      <TopBar
        saveStatus={saveStatus}
        machineName={machineName}
        onTakeTour={(from) => tour.start(from)}
      />
      <Tour
        id="workspace"
        running={tour.running}
        origin={tour.origin}
        onEnd={tour.end}
        revealPane={reveal}
      />
      {saveStatus.state === "failed" && <SaveFailed message={saveStatus.error} />}
      {saveStatus.state === "error" && <SaveError message={saveStatus.error} />}
      {/* Below the panels' minimum widths (200 + 200px), scroll sideways instead of clipping them. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-100"
          defaultLayout={savedLayout(layout.columns, ["sidebar", "viewport"])}
          onLayoutChanged={remember("columns")}
        >
          <ResizablePanel
            id="sidebar"
            defaultSize={300}
            minSize={200}
            maxSize="50%"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
          >
            <ResizablePanelGroup
              orientation="vertical"
              groupRef={sidebar}
              defaultLayout={savedLayout(layout.sidebar, [...Object.keys(panes), SIDEBAR_REST])}
              onLayoutChanged={remember("sidebar")}
            >
              <Pane
                id="operations"
                title={t("operations")}
                panel={operationsPanel}
                onToggle={() => toggle("operations")}
                defaultSize="35"
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
              </Pane>
              <ResizableHandle />
              <Pane
                id="properties"
                title={t("properties")}
                panel={propertiesPanel}
                onToggle={() => toggle("properties")}
                defaultSize="45"
                footer={<ExportProjectButton getDocument={getDocument} className="w-full" />}
              >
                <StockProperties machines={library.machines} />
              </Pane>
              <ResizableHandle />
              <Pane
                id="versions"
                title={t("versions")}
                panel={versionsPanel}
                onToggle={() => toggle("versions")}
                defaultSize="20"
              >
                <VersionsPane />
              </Pane>
              {/* No handle: it only holds the space below the headers while every pane is collapsed. */}
              <ResizablePanel id={SIDEBAR_REST} defaultSize="0" minSize={0} />
            </ResizablePanelGroup>
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
      className="absolute top-2 right-2 z-10 max-h-[calc(100%-1rem)] w-80 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border bg-background/95 shadow-xs"
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

type PanelRef = ReturnType<typeof usePanelRef>;

/** The empty panel under the sidebar's panes. */
const SIDEBAR_REST = "rest";

/** The height of a pane's header (`h-control`) in rem, all that a collapsed pane shows. */
const PANE_HEADER_REM = 1.75;

/** The smallest an open pane gets, in pixels. */
const PANE_MIN_SIZE = 96;

/**
 * A sidebar pane: dragging its edge resizes it, and its header calls
 * `onToggle` to collapse it to just the header or expand it. `footer` stays
 * at its bottom while the rest scrolls. A collapsed pane's content stays
 * mounted, only hidden.
 */
function Pane({
  id,
  title,
  panel,
  onToggle,
  defaultSize,
  footer,
  children,
}: {
  id: string;
  title: string;
  panel: PanelRef;
  onToggle: () => void;
  defaultSize: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <ResizablePanel
      id={id}
      panelRef={panel}
      defaultSize={defaultSize}
      minSize={PANE_MIN_SIZE}
      collapsible
      collapsedSize={`${PANE_HEADER_REM}rem`}
      onResize={() => setCollapsed(panel.current?.isCollapsed() ?? false)}
    >
      <section aria-label={title} data-tour={id} className="flex h-full flex-col">
        <h2 className="h-control shrink-0 border-b text-ui-label font-medium tracking-wide text-muted-foreground uppercase">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className="flex size-full items-center gap-1 px-2 uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
            />
            {title}
          </button>
        </h2>
        {/*
          Hidden rather than unmounted, so a collapsed pane keeps its state and running actions.
          Relative, so absolute content (`sr-only` inputs) scrolls with it instead of growing the page.
        */}
        <div hidden={collapsed} className="relative min-h-0 flex-1 overflow-auto">
          {children}
        </div>
        {footer && (
          <div hidden={collapsed} className="shrink-0 border-t p-2">
            {footer}
          </div>
        )}
      </section>
    </ResizablePanel>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-ui text-muted-foreground">{children}</p>;
}
