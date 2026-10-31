"use client";

import type { Operation } from "@furrow/document";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useTargetsLabel } from "../hooks/use-targets-label";
import { selectionTargets } from "../lib/path-selection";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import {
  addDrillOperation,
  addEngraveOperation,
  addPocketOperation,
  addProfileOperation,
  addReliefFinishOperation,
  addReliefRoughOperation,
  addVCarveOperation,
} from "../stores/operation-actions";
import { OperationTypeIcon } from "./operation-type-icon";
import { RibbonButton } from "./ribbon";
import {
  cuttingToolChoice,
  defaultToolChoice,
  drillToolChoice,
  engraveToolChoice,
  reliefFinishToolChoice,
  reliefRoughToolChoice,
  useToolLibrary,
  vcarveToolChoice,
} from "./tool-library";

/**
 * The ribbon's buttons adding profiles, pockets, drill, engrave and V-carve
 * operations from the selected paths, and 3D operations on the project's
 * model. A drawing project gets the first, a model project the second (a
 * project holds drawings or one model, ADR-0055).
 */
export function AddOperationButtons() {
  const t = useTranslations("Operations");
  const ribbon = useTranslations("Ribbon");
  const targetsLabel = useTargetsLabel();
  // Why profiles, pockets and 3D operations can't be added with only drill bits in the library.
  const sideways = t("sideways");
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const targets = useMemo(
    () => selectionTargets(geometry, selectedPaths),
    [geometry, selectedPaths],
  );
  const tools = useToolLibrary();
  const tool = defaultToolChoice(tools);
  const cuttingTool = cuttingToolChoice(tools);
  const models = useDocumentStore((s) => s.document.models);
  const selectedModelId = useWorkspaceStore((s) => s.selectedModelId);
  // The selected model, or the project's only one.
  const model =
    models.find(({ id }) => id === selectedModelId) ?? (models.length === 1 ? models[0] : null);
  const target = targets.length === 0 ? undefined : targetsLabel(targets);

  function added(id: string | null) {
    if (id) workspace.getState().selectOperation(id);
  }

  const kinds: {
    type: Operation["type"];
    /** The new operation's name. */
    label: string;
    /** On the button: shorter where the project's kind says the rest (3D). */
    short: string;
    add: (choice: NonNullable<typeof tool>) => string | null;
    choice: typeof tool;
    hint: string;
    /** Why there is no fitting tool when the library has others. */
    missingTool: string;
    /** What has to be selected first, until it is. */
    needs: string | undefined;
  }[] = [];

  if (geometry.length > 0 || models.length === 0) {
    const pathKinds = [
      ["profile", addProfileOperation, cuttingTool, sideways],
      ["pocket", addPocketOperation, cuttingTool, sideways],
      ["drill", addDrillOperation, drillToolChoice(tools), t("missingDrill")],
      ["engrave", addEngraveOperation, engraveToolChoice(tools), t("missingEngrave")],
      ["vcarve", addVCarveOperation, vcarveToolChoice(tools), t("missingVCarve")],
    ] as const;
    for (const [type, addOperation, choice, missingTool] of pathKinds) {
      const label = t(`types.${type}`);
      kinds.push({
        type,
        label,
        short: label,
        // On the side in view (ADR-0060), the top in a one-sided project.
        add: (choice) =>
          addOperation(store, {
            targets,
            tool: choice.tool,
            name: label,
            stockSide: workspace.getState().side,
          }),
        choice,
        hint: t(`hints.${type}`, { target: target ?? "" }),
        missingTool,
        needs: target ? undefined : t("selectPaths"),
      });
    }
  }
  if (models.length > 0) {
    const modelKinds = [
      ["relief_rough", addReliefRoughOperation, reliefRoughToolChoice(tools)],
      ["relief_finish", addReliefFinishOperation, reliefFinishToolChoice(tools)],
    ] as const;
    for (const [type, addOperation, choice] of modelKinds) {
      const label = t(`types.${type}`);
      kinds.push({
        type,
        label,
        short: ribbon(type),
        add: (choice) =>
          model
            ? addOperation(store, {
                modelId: model.id,
                tool: choice.tool,
                name: label,
                stockSide: workspace.getState().side,
              })
            : null,
        choice,
        hint: t(`hints.${type}`, { model: model?.fileName ?? "" }),
        missingTool: sideways,
        needs: model ? undefined : t("selectModel"),
      });
    }
  }

  return kinds.map(({ type, label, short, add, choice, hint, missingTool, needs }) => (
    <RibbonButton
      key={type}
      icon={<OperationTypeIcon type={type} />}
      label={short}
      aria-label={t("addLabel", { operation: label })}
      hint={hint}
      disabledReason={!choice ? (tool ? missingTool : t("noTool")) : needs}
      onClick={() => choice && added(add(choice))}
    />
  ));
}
