"use client";

import { MIN_LENGTH, vBitConeDepth } from "@furrow/cam-core";
import type { OperationTarget } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useLength } from "../hooks/use-length";
import type { ToolChoice } from "../lib/workspace-host";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { inlayMaxDepth, makeInlay } from "../stores/inlay-actions";
import { RibbonButton } from "./ribbon";
import { flatBottomToolChoice, vcarveToolChoice } from "./tool-library";

/** How deep a new inlay's pocket goes, unless the bit's cone or half the stock is shallower. */
const DEFAULT_INLAY_DEPTH = 5;
/** The glue gap under a new inlay's plug, unless the pocket is shallower than twice it. */
const DEFAULT_INLAY_GAP = 1;

/**
 * Opens *Make inlay* (#553) for the selected paths: a V-carve pocket of them
 * and a plug that fits it, which needs a V-bit and a flat end mill.
 */
export function InlayButton({
  targets,
  target,
  tools,
}: {
  targets: OperationTarget[];
  /** The selection, as hints name it, or `undefined` with none. */
  target: string | undefined;
  tools: ToolChoice[];
}) {
  const t = useTranslations("Inlay");
  const operations = useTranslations("Operations");
  const [open, setOpen] = useState(false);
  const tool = vcarveToolChoice(tools);
  const flatTool = flatBottomToolChoice(tools);
  const disabledReason =
    tools.length === 0
      ? operations("noTool")
      : !tool
        ? operations("missingVCarve")
        : !flatTool
          ? t("missingFlat")
          : target
            ? undefined
            : operations("selectPaths");
  return (
    <>
      <RibbonButton
        icon={<PuzzleIcon />}
        label={t("ribbon")}
        aria-label={t("title")}
        data-demo="add-inlay"
        hint={t("hint", { target: target ?? "" })}
        disabledReason={disabledReason}
        onClick={() => setOpen(true)}
      />
      {open && tool && flatTool && (
        <InlayDialog
          targets={targets}
          tool={tool}
          flatTool={flatTool}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function InlayDialog({
  targets,
  tool,
  flatTool,
  onClose,
}: {
  targets: OperationTarget[];
  tool: ToolChoice;
  flatTool: ToolChoice;
  onClose: () => void;
}) {
  const t = useTranslations("Inlay");
  const format = useFormatMessage();
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const thickness = useDocumentStore((s) => s.document.stock.thickness);
  const length = useLength(units);
  // Half the stock leaves room for the plug's floor, at twice the depth less the gap.
  const [depth, setDepth] = useState(() =>
    Math.min(DEFAULT_INLAY_DEPTH, vBitConeDepth(tool.tool) ?? Infinity, thickness / 2),
  );
  const [gap, setGap] = useState(() => Math.min(DEFAULT_INLAY_GAP, depth / 2));
  const [error, setError] = useState<Translatable | null>(null);
  const maxDepth = inlayMaxDepth(tool.tool, thickness, gap);

  function make() {
    const { geometry, drawings } = store.getState().document;
    const shape = geometry.find(({ id }) => id === targets[0]?.shapeId);
    const drawing = drawings.find(({ id }) => id === shape?.drawingId);
    const result = makeInlay(store, {
      targets,
      tool: tool.tool,
      flatTool: flatTool.tool,
      depth,
      gap,
      stockSide: workspace.getState().side,
      names: {
        pocket: t("pocket"),
        plug: t("plug"),
        drawing: t("drawing", { name: drawing?.name ?? "" }),
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    workspace.getState().selectOperation(result.id);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <NumberField
            id="inlay-depth"
            label={t("depth")}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_LENGTH}
            max={maxDepth}
            value={depth}
            onValueChange={setDepth}
          />
          <NumberField
            id="inlay-gap"
            label={t("gap")}
            layout="inline"
            quantity="length"
            units={units}
            min={0}
            value={gap}
            onValueChange={setGap}
          />
          <p className="text-muted-foreground">
            {t("tools", {
              tool: tool.tool.name,
              flatTool: flatTool.tool.name,
              start: length(Math.max(0, depth - gap)),
            })}
          </p>
          <p className="text-muted-foreground">{t("separate")}</p>
          {error && (
            <p className="text-destructive" role="alert">
              {format(error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={make}>{t("make")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
