"use client";

import { type PlaybackPath, playbackPosition } from "@furrow/cam-core";
import { useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type Group, LatheGeometry, Vector2 } from "three";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { cutterOutline } from "@/features/workspace/lib/cutter-outline";
import { type PlaybackPart, partProgress } from "@/features/workspace/lib/playback-moves";
import {
  createPlaybackStore,
  type PlaybackStore,
} from "@/features/workspace/stores/playback-store";

/** Sides of the drawn tool. */
const TOOL_SIDES = 32;

/** A playback (#100) as the scene draws it. */
export type PlaybackScene = { store: PlaybackStore; path: PlaybackPath; parts: PlaybackPart[] };

const PlaybackContext = createContext<PlaybackScene | null>(null);

export const PlaybackProvider = PlaybackContext;

/**
 * How many feed and rapid segments of an operation's toolpath (or of its
 * clearing moves) the playback has cut, re-rendering as they change;
 * `undefined` when no playback is running.
 */
export function usePlaybackProgress(
  operationId: string,
  clearing: boolean,
): { feeds: number; rapids: number } | undefined {
  const playback = useContext(PlaybackContext);
  const part = playback?.parts.find(
    (candidate) => candidate.operationId === operationId && candidate.clearing === clearing,
  );
  const progress = useStore(
    playback?.store ?? IDLE,
    useShallow((state) => {
      if (!playback || !part) return NONE;
      const at = playbackPosition(playback.path, state.distance);
      return at ? partProgress(part, at.move) : NONE;
    }),
  );
  return playback && part ? progress : undefined;
}

const NONE = { feeds: 0, rapids: 0 };

/** What `useStore` reads outside a playback, which must always be given a store. */
const IDLE = createPlaybackStore();

/**
 * The tool at the playback's position, drawn turning with its real shape and
 * diameter (`cutterOutline`) in its tool's colour. It moves without
 * re-rendering, as the playback store changes.
 */
export function PlaybackTool() {
  const playback = useContext(PlaybackContext);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const [cut, setCut] = useState(0);

  useEffect(() => {
    if (!playback) return;
    const { store, path } = playback;
    function place(distance: number) {
      const at = playbackPosition(path, distance);
      if (!at || !group.current) return;
      group.current.position.set(...at.point);
      setCut(at.cut);
      invalidate();
    }
    place(store.getState().distance);
    return store.subscribe((state, previous) => {
      if (state.distance !== previous.distance) place(state.distance);
    });
  }, [playback, invalidate]);

  const tool = playback?.path.cuts[cut]?.tool ?? null;
  const geometry = useMemo(() => {
    if (!tool) return null;
    const outline = cutterOutline(tool).map(([r, z]) => new Vector2(r, z));
    // Turned about Y, then stood up along Z.
    return new LatheGeometry(outline, TOOL_SIDES).rotateX(Math.PI / 2);
  }, [tool]);
  useEffect(
    () => () => {
      geometry?.dispose();
      invalidate();
    },
    [geometry, invalidate],
  );
  if (!playback || !geometry) return null;
  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        <meshMatcapMaterial color={playback.parts[cut]?.color ?? "#71717a"} />
      </mesh>
    </group>
  );
}
