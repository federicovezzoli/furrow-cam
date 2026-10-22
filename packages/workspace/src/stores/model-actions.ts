import {
  anchorPoint,
  initialPlacement,
  modelRect,
  proportionalDepth,
  replacePlacement,
  stockFit,
  translatePoint,
  turnModel,
  xyOriginPosition,
} from "@furrow/cam-core";
import {
  MODEL_BORDER,
  type Model,
  type ModelPlacement,
  type Operation,
  operationModelId,
  type Point,
  type ProjectDocument,
  type Stock,
  type StockAnchor,
} from "@furrow/document";
import type { Draft } from "immer";
import type { DocumentStore } from "./document-store";
import { canImportModel } from "./geometry-actions";

/**
 * Document store actions on imported 3D models (PRD-0005 S2, ADR-0031): each
 * change is one undo step, or part of the open transaction.
 */

/**
 * The point of a model that is measured from the zero and stays put when it
 * is turned or scaled: the zero's anchor, or the bottom-left corner for a
 * custom zero.
 */
export function modelAnchor(stock: Pick<Stock, "xyOrigin">): StockAnchor {
  const { anchor } = stock.xyOrigin;
  return anchor === "custom" ? "bottom_left" : anchor;
}

/** Where a model is relative to the XY zero: its point at `modelAnchor`, in millimetres. */
export function modelOffset(stock: Stock, model: Pick<Model, "bounds" | "placement">): Point {
  const [x, y] = anchorPoint(modelRect(model), modelAnchor(stock));
  const [zx, zy] = xyOriginPosition(stock);
  return [x - zx, y - zy];
}

function changeModel(
  store: DocumentStore,
  name: string,
  id: string,
  recipe: (model: Draft<Model>, current: Model) => void,
) {
  const current = store.getState().document.models.find((model) => model.id === id);
  if (!current) return;
  store.getState().change(name, (draft) => {
    const model = draft.models.find((m) => m.id === id);
    if (model) recipe(model, current);
  });
}

/** Assigns the fields of `placement` that differ, so an unchanged value adds no undo step. */
function assignPlacement(model: Draft<Model>, placement: ModelPlacement) {
  const draft = model.placement;
  if (draft.rotation.some((turn, i) => turn !== placement.rotation[i])) {
    draft.rotation = placement.rotation;
  }
  if (draft.scale !== placement.scale) draft.scale = placement.scale;
  if (draft.depth !== placement.depth) draft.depth = placement.depth;
  if (draft.position[0] !== placement.position[0] || draft.position[1] !== placement.position[1]) {
    draft.position = placement.position;
  }
}

/**
 * Adds an imported mesh as a model, as one undo step: fitted inside the
 * stock less a border, its top at the stock top and aligned at the zero's
 * anchor (ADR-0031, ADR-0038). A project holds drawings or one model (ADR-0055): returns
 * `null`, adding nothing, if it already has a drawing or a model;
 * otherwise the model's id.
 */
export function addModel(
  store: DocumentStore,
  mesh: Omit<Model, "id" | "placement" | "border">,
): string | null {
  const { document } = store.getState();
  if (!canImportModel(document)) return null;
  const { stock } = document;
  const id = crypto.randomUUID();
  // The border it is fitted with is the one it keeps.
  const border = MODEL_BORDER;
  const placement = initialPlacement(mesh.bounds, stock, modelAnchor(stock), border);
  store.getState().change("addModel", (draft) => {
    draft.models.push({ ...mesh, id, placement, border });
  });
  return id;
}

/** The operations that machine the model `id`, which go with it. */
export function modelOperations(document: ProjectDocument, id: string): Operation[] {
  return document.operations.filter((operation) => operationModelId(operation) === id);
}

/** Removes a model and the operations that machine it, as one undo step. */
export function removeModel(store: DocumentStore, id: string) {
  store.getState().change("removeModel", (draft) => {
    const index = draft.models.findIndex((model) => model.id === id);
    if (index === -1) return;
    draft.models.splice(index, 1);
    draft.operations = draft.operations.filter(
      (operation) => operationModelId(operation as Operation) !== id,
    );
  });
}

/** Turns a model a quarter turn about the stock's `axis`, keeping its anchor point in place. */
export function turnModelAbout(store: DocumentStore, id: string, axis: 0 | 1 | 2) {
  const { stock } = store.getState().document;
  changeModel(store, "turnModel", id, (model, current) => {
    const rotation = turnModel(current.placement.rotation, axis);
    assignPlacement(model, replacePlacement(current, { rotation }, modelAnchor(stock)));
  });
}

/** Scales a model in all three directions, keeping its anchor point in place. */
export function setModelScale(store: DocumentStore, id: string, scale: number) {
  const { stock } = store.getState().document;
  changeModel(store, "setModel.scale", id, (model, current) => {
    assignPlacement(model, replacePlacement(current, { scale }, modelAnchor(stock)));
  });
}

/**
 * Scales a model to fit inside the stock less its border, aligned to it at
 * the anchor (`stockFit`).
 */
export function fitModelToStock(store: DocumentStore, id: string) {
  const { stock } = store.getState().document;
  changeModel(store, "fitModel", id, (model, current) => {
    const { rotation } = current.placement;
    const anchor = modelAnchor(stock);
    const { scale, position } = stockFit(current.bounds, rotation, stock, anchor, current.border);
    assignPlacement(model, {
      ...current.placement,
      scale,
      depth: proportionalDepth(current.bounds, rotation, scale) ?? current.placement.depth,
      position,
    });
  });
}

/**
 * Sets the border *Fit to stock* leaves around a model (ADR-0038), without
 * fitting it: the next fit applies it.
 */
export function setModelBorder(store: DocumentStore, id: string, border: number) {
  changeModel(store, "setModel.border", id, (model) => {
    if (model.border !== border) model.border = border;
  });
}

/**
 * Scales a model so it reaches `depth` millimetres into the stock from its
 * top, in all three directions: the mesh keeps its proportions (ADR-0034).
 * A flat model has no depth to set.
 */
export function setModelDepth(store: DocumentStore, id: string, depth: number) {
  const { stock } = store.getState().document;
  changeModel(store, "setModel.depth", id, (model, current) => {
    const height = proportionalDepth(current.bounds, current.placement.rotation, 1);
    if (height === null) return;
    const scale = depth / height;
    assignPlacement(model, replacePlacement(current, { scale }, modelAnchor(stock)));
  });
}

/**
 * Moves a model along one axis so that its anchor point is `value`
 * millimetres from the XY zero (`modelOffset`).
 */
export function setModelOffset(store: DocumentStore, id: string, axis: "x" | "y", value: number) {
  const { stock } = store.getState().document;
  changeModel(store, `setModel.position.${axis}`, id, (model, current) => {
    const i = axis === "x" ? 0 : 1;
    const delta: Point = [0, 0];
    delta[i] = value - (modelOffset(stock, current)[i] as number);
    assignPlacement(model, {
      ...current.placement,
      position: translatePoint(current.placement.position, delta),
    });
  });
}
