"use client";

import type { OperationTarget } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { XIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useSelectionTargets } from "../../hooks/use-selection-targets";
import { useTargetsLabel } from "../../hooks/use-targets-label";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { setDrillPins, setOperationTargets } from "../../stores/operation-actions";

export function TargetsField({
  operationId,
  targets,
  pins,
  placedHoles,
}: {
  operationId: string;
  targets: OperationTarget[];
  /** For a drill: whether it cuts the locating pins, or may. */
  pins: "on" | "available" | null;
  /**
   * For a drill with placed holes (#429): the last shape can go too, and the
   * holes are removed before it can cut the locating pins.
   */
  placedHoles: boolean;
}) {
  const t = useTranslations("Operation");
  const targetsLabel = useTargetsLabel();
  const store = useDocumentStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selected = useSelectionTargets();
  const rows = useMemo(() => {
    const shapes = new Map(geometry.map((shape) => [shape.id, shape]));
    return targets.flatMap((target) => {
      const shape = shapes.get(target.shapeId);
      return shape ? [{ shape, paths: target.paths }] : [];
    });
  }, [geometry, targets]);

  return (
    <section aria-labelledby="operation-shapes-heading" className="grid gap-1">
      <div className="flex items-center gap-2">
        <h4 id="operation-shapes-heading" className="flex-1">
          {t("shapes")}
        </h4>
        <Button
          variant="outline"
          size="compact"
          disabled={selected.length === 0}
          onClick={() => setOperationTargets(store, operationId, selected)}
          title={
            selected.length > 0
              ? t("cutInstead", { targets: targetsLabel(selected) })
              : t("selectToCut")
          }
        >
          {t("useSelected")}
        </Button>
        {pins === "available" && (
          <Button
            variant="outline"
            size="compact"
            disabled={placedHoles}
            title={placedHoles ? t("pinsWithoutHoles") : undefined}
            onClick={() => setDrillPins(store, operationId)}
          >
            {t("usePins")}
          </Button>
        )}
      </div>
      {pins === "on" && <p>{t("locatingPins")}</p>}
      <ul className="grid gap-0.5">
        {rows.map(({ shape, paths }) => (
          <li key={shape.id} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{shape.name || t("unnamedShape")}</span>
            {paths && (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t("pathsOf", { count: paths.length, total: shape.paths.length })}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-compact"
              disabled={rows.length === 1 && !placedHoles}
              onClick={() =>
                setOperationTargets(
                  store,
                  operationId,
                  targets.filter((target) => target.shapeId !== shape.id),
                )
              }
              aria-label={t("removeLabel", { name: shape.name || t("unnamedShape") })}
              title={rows.length === 1 && !placedHoles ? t("needsShape") : t("remove")}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The model a 3D operation machines. */
export function ModelField({ modelId }: { modelId: string }) {
  const t = useTranslations("Operation");
  const model = useDocumentStore((s) => s.document.models.find(({ id }) => id === modelId));
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <span>{t("model")}</span>
      <span className="truncate" title={model?.fileName}>
        {model?.fileName ?? t("missing")}
      </span>
    </div>
  );
}
