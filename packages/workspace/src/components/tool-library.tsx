"use client";

import {
  canClearFlatBottom,
  canDrill,
  canEngrave,
  canVCarve,
  DEFAULT_TOOL_PRESET,
  type Operation,
  TOOL_PRESETS,
  type Tool,
  type ToolType,
} from "@furrow/document";
import type * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ToolChoice } from "../lib/workspace-host";
import { toolKey } from "../stores/operation-actions";

const ToolLibraryContext = createContext<ToolChoice[]>([]);
const UpdateToolContext = createContext<(id: string, tool: Tool) => void>(() => {});
const AddToolContext = createContext<(choice: ToolChoice) => void>(() => {});

/**
 * The user's tool library, as the workspace host has it, with the bits added
 * or edited from it applied until the host has the library again, followed by
 * the bit catalog.
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
    // The host has the library again (e.g. after a refresh): it wins.
    setLoaded(initial);
    setTools(initial);
  }
  const updateTool = useCallback((id: string, tool: Tool) => {
    setTools((current) => withUpdatedTool(current, id, tool));
  }, []);
  const addTool = useCallback((choice: ToolChoice) => {
    setTools((current) => withAddedTool(current, choice));
  }, []);
  const offered = useMemo(() => withCatalog(tools), [tools]);
  return (
    <ToolLibraryContext value={offered}>
      <UpdateToolContext value={updateTool}>
        <AddToolContext value={addTool}>{children}</AddToolContext>
      </UpdateToolContext>
    </ToolLibraryContext>
  );
}

/**
 * The library `tools` followed by the catalog bits (PRD-0008 G4), leaving out
 * those the library already has as they are, such as the default bit seeded
 * into new libraries. The catalog's default bit is the default when the
 * library has none.
 */
export function withCatalog(tools: ToolChoice[]): ToolChoice[] {
  const owned = new Set(tools.map((choice) => toolKey(choice.tool)));
  const hasDefault = tools.some((choice) => choice.isDefault);
  const catalog = TOOL_PRESETS.filter((preset) => !owned.has(toolKey(preset.tool))).map(
    ({ id, tool }): ToolChoice => ({
      id,
      isDefault: !hasDefault && id === DEFAULT_TOOL_PRESET.id,
      tool,
      catalog: true,
    }),
  );
  return [...tools, ...catalog];
}

/** `tools` with the tool `id` replaced by its saved version. */
export function withUpdatedTool(tools: ToolChoice[], id: string, tool: Tool): ToolChoice[] {
  return tools.map((choice) => (choice.id === id ? { ...choice, tool } : choice));
}

/** `tools` with `choice` added, keeping the library's order by name. */
export function withAddedTool(tools: ToolChoice[], choice: ToolChoice): ToolChoice[] {
  if (tools.some((existing) => existing.id === choice.id)) return tools;
  const index = tools.findIndex(
    (existing) => existing.tool.name.localeCompare(choice.tool.name) > 0,
  );
  return index === -1 ? [...tools, choice] : tools.toSpliced(index, 0, choice);
}

export function useToolLibrary() {
  return useContext(ToolLibraryContext);
}

/** Replaces the library tool `id` with its saved version. */
export function useUpdateTool() {
  return useContext(UpdateToolContext);
}

/** Adds a tool just created in the library. */
export function useAddTool() {
  return useContext(AddToolContext);
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

/** The bit type a new bit starts as when created for an operation of `type`. */
export function newBitType(type: Operation["type"]): ToolType {
  switch (type) {
    case "drill":
      return "drill";
    case "engrave":
    case "vcarve":
      return "v_bit";
    case "relief_finish":
      return "ball_end_mill";
    default:
      return "flat_end_mill";
  }
}
