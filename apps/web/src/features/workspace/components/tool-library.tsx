"use client";

import { canClearFlatBottom, canDrill, canEngrave, canVCarve, type Tool } from "@furrow/document";
import type * as React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import type { ToolChoice } from "@/features/tools/server";
import { toolKey } from "@/features/workspace/stores/operation-actions";

const ToolLibraryContext = createContext<ToolChoice[]>([]);
const UpdateToolContext = createContext<(id: string, tool: Tool) => void>(() => {});

/**
 * The signed-in user's tool library, as loaded with the workspace, with the
 * bits edited from it applied until the server sends the library again.
 */
export function ToolLibraryProvider({
  tools: initial,
  children,
}: {
  tools: ToolChoice[];
  children: React.ReactNode;
}) {
  const [tools, setTools] = useState(initial);
  const [loaded, setLoaded] = useState(initial);
  if (loaded !== initial) {
    // The server sent the library again (e.g. after a refresh): it wins.
    setLoaded(initial);
    setTools(initial);
  }
  const updateTool = useCallback((id: string, tool: Tool) => {
    setTools((current) =>
      current.map((choice) => (choice.id === id ? { ...choice, tool } : choice)),
    );
  }, []);
  return (
    <ToolLibraryContext value={tools}>
      <UpdateToolContext value={updateTool}>{children}</UpdateToolContext>
    </ToolLibraryContext>
  );
}

export function useToolLibrary() {
  return useContext(ToolLibraryContext);
}

/** Replaces the library tool `id` with its saved version. */
export function useUpdateTool() {
  return useContext(UpdateToolContext);
}

/** The tool new operations start with: the default one, else the first. */
export function defaultToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return tools.find((choice) => choice.isDefault) ?? tools[0];
}

/** The default tool if it passes `test`, else the first that does. */
function toolChoiceFor(tools: ToolChoice[], test: (tool: Tool) => boolean): ToolChoice | undefined {
  const fallback = defaultToolChoice(tools);
  return fallback && test(fallback.tool) ? fallback : tools.find((choice) => test(choice.tool));
}

/** The tool new drill operations start with: the default one if it can drill, else the first that can. */
export function drillToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, canDrill);
}

/**
 * The tool new engrave operations start with: the default one if it is a
 * V-bit, else the first V-bit, else the default one if it can engrave, else
 * the first that can.
 */
export function engraveToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, (tool) => tool.type === "v_bit") ?? toolChoiceFor(tools, canEngrave);
}

/** The tool new V-carves start with: the default one if it is a V-bit, else the first V-bit. */
export function vcarveToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, canVCarve);
}

/**
 * The tool new 3D finishing operations start with: the default one if it is
 * a ball end mill, else the first ball end mill, else the default one.
 */
export function reliefFinishToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, (tool) => tool.type === "ball_end_mill") ?? defaultToolChoice(tools);
}

/**
 * The tool new 3D roughing operations start with: the default one if it is
 * a flat end mill, else the first flat end mill, else the default one.
 */
export function reliefRoughToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, (tool) => tool.type === "flat_end_mill") ?? defaultToolChoice(tools);
}

/** The tool a V-carve's flat bottom starts with: the default one if it is a flat end mill, else the first. */
export function flatBottomToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return toolChoiceFor(tools, canClearFlatBottom);
}

/** The library tool an operation's snapshot was taken from, if it hasn't been edited since. */
export function matchingToolChoice(tools: ToolChoice[], tool: Tool): ToolChoice | undefined {
  const key = toolKey(tool);
  return tools.find((choice) => toolKey(choice.tool) === key);
}
