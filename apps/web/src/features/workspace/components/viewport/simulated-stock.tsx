"use client";

import type { CellRange, Heightmap } from "@furrow/cam-core";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  InstancedBufferGeometry,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
} from "three";
import type { HeightmapUpdates } from "@/features/workspace/hooks/use-playback";
import {
  simulationTexture,
  skirtPositions,
  TEXTURE_WIDTH,
} from "@/features/workspace/lib/simulation-mesh";

/** One quad between four neighbouring cell centres; each instance places one. */
const QUAD = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);

const VERTEX_SHADER = /* glsl */ `
uniform sampler2D heights;
uniform ivec2 grid;
uniform vec2 cell;
uniform float thickness;
varying vec3 vPosition;
varying float vDepth;

float heightAt(int column, int row) {
  column = clamp(column, 0, grid.x - 1);
  row = clamp(row, 0, grid.y - 1);
  int i = row * grid.x + column;
  return texelFetch(heights, ivec2(i % ${TEXTURE_WIDTH}, i / ${TEXTURE_WIDTH}), 0).r;
}

/** Cell centres, except on the outer cells, which reach to the stock's edges. */
float edgeAt(int index, int count, float size) {
  if (index == 0) return 0.0;
  if (index == count - 1) return float(count) * size;
  return (float(index) + 0.5) * size;
}

void main() {
  int c = gl_InstanceID % (grid.x - 1);
  int r = gl_InstanceID / (grid.x - 1);
  vec2 uv = position.xy;
  // Split along the diagonal whose corners are closest in height, so the
  // crease follows a wall instead of zig-zagging across it.
  float h00 = heightAt(c, r);
  float h11 = heightAt(c + 1, r + 1);
  float h10 = heightAt(c + 1, r);
  float h01 = heightAt(c, r + 1);
  if (abs(h00 - h11) > abs(h10 - h01)) uv.x = 1.0 - uv.x;
  int column = c + int(uv.x);
  int row = r + int(uv.y);
  float z = heightAt(column, row);
  vDepth = -z / thickness;
  vec3 at = vec3(edgeAt(column, grid.x, cell.x), edgeAt(row, grid.y, cell.y), z);
  vec4 world = modelMatrix * vec4(at, 1.0);
  vPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 color;
varying vec3 vPosition;
varying float vDepth;

void main() {
  // Shaded flat, each triangle by its own normal, so floors and walls meet at
  // a crisp edge rather than one blurred across neighbouring cells.
  vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
  if (dot(normal, cameraPosition - vPosition) < 0.0) normal = -normal;
  /**
   * A fixed light from the front left, and darker the deeper the cut, so
   * floors stand out from the top even in the top view.
   */
  float light = 0.55 + 0.45 * max(dot(normal, normalize(vec3(-0.4, -0.6, 1.0))), 0.0);
  gl_FragColor = vec4(color * light * mix(1.0, 0.55, clamp(vDepth, 0.0, 1.0)), 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Asks three.js to upload only the texture rows holding cells `range`. Its
 * update ranges count four components per texel, whatever the format, so a
 * one-channel texture's cells are counted four times over.
 */
function addTextureRows(texture: DataTexture, { start, end }: CellRange) {
  for (let row = Math.floor(start / TEXTURE_WIDTH); row * TEXTURE_WIDTH < end; row++) {
    const from = Math.max(start, row * TEXTURE_WIDTH);
    const to = Math.min(end, (row + 1) * TEXTURE_WIDTH);
    texture.addUpdateRange(from * 4, (to - from) * 4);
  }
}

/** Shade of the stock's sides, against its uncut top. */
const SIDE_SHADE = 0.7;

/**
 * The stock as simulated after cutting (ADR-0019): the heightmap drawn as a
 * surface through its cell centres, shaded flat so floors and walls meet at
 * crisp edges, with walls down to the stock bottom around it. Each cell is one instance of a quad that the vertex shader
 * lifts to the heights it reads from a float texture, so a 4-million-cell
 * heightmap costs that texture and no per-vertex buffers. Models are drawn
 * the same way, from their previews (ADR-0031).
 *
 * During a playback (#100) the heights change in place, and `updates` says
 * which: only those texture rows are uploaded again.
 */
export function SimulatedStock({
  heightmap,
  thickness,
  color,
  updates,
}: {
  heightmap: Heightmap;
  thickness: number;
  color: string;
  updates?: HeightmapUpdates;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const { columns, rows, cellWidth, cellHeight } = heightmap;

  const texture = useMemo(() => {
    const { data, height } = simulationTexture(heightmap.heights);
    const t = new DataTexture(data, TEXTURE_WIDTH, height, RedFormat, FloatType);
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [heightmap.heights]);

  const surface = useMemo(() => {
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(QUAD, 3));
    g.instanceCount = (columns - 1) * (rows - 1);
    return g;
  }, [columns, rows]);

  // Built with its uniforms from the current props, so no frame draws the
  // new geometry with the old grid or texture. Programs are cached by shader,
  // so a new material per heightmap doesn't recompile.
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          heights: { value: texture },
          grid: { value: [columns, rows] },
          cell: { value: [cellWidth, cellHeight] },
          thickness: { value: thickness },
          color: { value: new Color(color) },
        },
        // A quad split along its other diagonal is mirrored, so it faces the other way.
        side: DoubleSide,
        // Lines on the uncut top (shapes) draw over it instead of flickering.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    [texture, columns, rows, cellWidth, cellHeight, thickness, color],
  );

  const skirt = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(skirtPositions(heightmap, thickness), 3));
    return g;
  }, [heightmap, thickness]);
  const sideColor = useMemo(() => new Color(color).multiplyScalar(SIDE_SHADE), [color]);

  useEffect(
    () =>
      updates?.subscribe((range) => {
        addTextureRows(texture, range);
        texture.needsUpdate = true;
        // The sides follow the heights along the edges, which cuts there change.
        const sides = skirt.getAttribute("position") as BufferAttribute;
        sides.copyArray(skirtPositions(heightmap, thickness));
        sides.needsUpdate = true;
        invalidate();
      }),
    [updates, texture, skirt, heightmap, thickness, invalidate],
  );

  useEffect(
    () => () => {
      texture.dispose();
      invalidate();
    },
    [texture, invalidate],
  );
  useEffect(() => () => surface.dispose(), [surface]);
  useEffect(() => () => skirt.dispose(), [skirt]);
  useEffect(
    () => () => {
      material.dispose();
      invalidate();
    },
    [material, invalidate],
  );

  return (
    <>
      {/* Its vertices move in the shader, so three.js can't tell where it is. */}
      <mesh geometry={surface} material={material} frustumCulled={false} />
      <mesh geometry={skirt}>
        <meshBasicMaterial color={sideColor} side={DoubleSide} />
      </mesh>
    </>
  );
}
