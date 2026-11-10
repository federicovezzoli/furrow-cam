"use client";

import { type Box3, placedModelBox, placementScale, rotatedSize } from "@furrow/cam-core";
import type { Model } from "@furrow/document";
import { Edges } from "@react-three/drei";
import { boxCenter } from "../../lib/viewport-scene";
import { useDocumentStore, useWorkspaceStore } from "../../providers/workspace-stores";
import { type ModelPreview, previewKey } from "../../stores/model-preview-scheduler";
import type { Palette } from "./scene-style";
import { SimulatedStock } from "./simulated-stock";

/** Thinnest outline drawn for a flat model, in millimetres. */
const MIN_OUTLINE = 0.01;

/**
 * The project's 3D models as they will be cut (PRD-0005 S3): each drawn from
 * its preview, the mesh seen from above with undercuts filled in, scaled and
 * moved as placed. A model whose preview isn't ready, or can't be drawn,
 * shows as the outline of its box; the selected one is outlined too. Models
 * are selected with paths, in either view (`PathPick`, #544).
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
  // A hidden model isn't drawn (ADR-0080).
  return models.flatMap((model) =>
    model.hidden
      ? []
      : [
          <PlacedModel
            key={model.id}
            model={model}
            preview={previews.get(previewKey(model))}
            selected={model.id === selectedId}
            palette={palette}
          />,
        ],
  );
}

function PlacedModel({
  model,
  preview,
  selected,
  palette,
}: {
  model: Model;
  preview: ModelPreview | undefined;
  selected: boolean;
  palette: Palette;
}) {
  const box = placedModelBox(model);
  const scale = placementScale(model);
  const height = rotatedSize(model.bounds, model.placement.rotation)[2];
  const heightmap = preview?.heightmap ?? null;

  return (
    <>
      {heightmap && (
        // The preview is in the rotated mesh's frame: its outline from (0, 0), its top at 0.
        <group position={[box.min[0], box.min[1], box.max[2]]} scale={scale}>
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
      />
    </>
  );
}

/** The edges of a model's box, in `outline`. */
function ModelBox({ box, outline }: { box: Box3; outline: string | null }) {
  const { min, max } = box;
  const size = [max[0] - min[0], max[1] - min[1], Math.max(max[2] - min[2], MIN_OUTLINE)] as const;
  if (outline === null) return null;
  return (
    <mesh position={boxCenter(box)}>
      <boxGeometry args={size} />
      <meshBasicMaterial visible={false} />
      {outline !== null && <Edges color={outline} />}
    </mesh>
  );
}
