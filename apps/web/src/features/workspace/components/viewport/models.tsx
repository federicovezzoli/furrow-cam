"use client";

import { type Box3, placedModelBox, placementScale, rotatedSize } from "@furrow/cam-core";
import type { Model } from "@furrow/document";
import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { boxCenter } from "@/features/workspace/lib/viewport-scene";
import {
  useDocumentStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import { type ModelPreview, previewKey } from "@/features/workspace/stores/model-preview-scheduler";
import type { Palette } from "./scene-style";
import { SimulatedStock } from "./simulated-stock";

/** Pointer travel, in pixels, past which a press is a drag (orbiting) rather than a click. */
const CLICK_THRESHOLD = 3;

/** Thinnest outline drawn for a flat model, in millimetres. */
const MIN_OUTLINE = 0.01;

/**
 * The project's 3D models as they will be cut (PRD-0005 S3): each drawn from
 * its preview, the mesh seen from above with undercuts filled in, scaled and
 * moved as placed. A model whose preview isn't ready, or can't be drawn,
 * shows as the outline of its box; the selected one is outlined too. The top
 * view selects models with paths (`PathPick`); the orbit view by clicking them.
 */
export function Models({
  previews,
  palette,
}: {
  previews: ReadonlyMap<string, ModelPreview>;
  palette: Palette;
}) {
  const models = useDocumentStore((s) => s.document.models);
  const selectedId = useWorkspaceStore((s) => s.selectedModelId);
  const orbit = useWorkspaceStore((s) => s.view === "orbit");
  return models.map((model) => (
    <PlacedModel
      key={model.id}
      model={model}
      preview={previews.get(previewKey(model))}
      selected={model.id === selectedId}
      clickable={orbit}
      palette={palette}
    />
  ));
}

function PlacedModel({
  model,
  preview,
  selected,
  clickable,
  palette,
}: {
  model: Model;
  preview: ModelPreview | undefined;
  selected: boolean;
  clickable: boolean;
  palette: Palette;
}) {
  const workspace = useWorkspaceStoreApi();
  const box = placedModelBox(model);
  const scale = placementScale(model);
  const height = rotatedSize(model.bounds, model.placement.rotation)[2];
  const heightmap = preview?.heightmap ?? null;

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > CLICK_THRESHOLD) return;
    event.stopPropagation();
    workspace.getState().selectModel(model.id);
  }

  return (
    <>
      {heightmap && (
        // The preview is in the rotated mesh's frame: its outline from (0, 0), its top at 0.
        <group position={[box.min[0], box.min[1], 0]} scale={scale}>
          <SimulatedStock
            heightmap={heightmap}
            thickness={Math.max(height, MIN_OUTLINE)}
            color={palette.model}
          />
        </group>
      )}
      <ModelBox
        box={box}
        outline={selected || !heightmap ? (selected ? palette.selected : palette.model) : null}
        onClick={clickable ? onClick : undefined}
      />
    </>
  );
}

/** An invisible box around a model, which takes clicks and draws its edges in `outline`. */
function ModelBox({
  box,
  outline,
  onClick,
}: {
  box: Box3;
  outline: string | null;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const { min, max } = box;
  const size = [max[0] - min[0], max[1] - min[1], Math.max(max[2] - min[2], MIN_OUTLINE)] as const;
  if (outline === null && !onClick) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element
    <mesh position={boxCenter(box)} onClick={onClick}>
      <boxGeometry args={size} />
      <meshBasicMaterial visible={false} />
      {outline !== null && <Edges color={outline} />}
    </mesh>
  );
}
