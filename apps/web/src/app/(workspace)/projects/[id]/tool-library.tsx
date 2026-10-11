"use client";

import { canDrill, type Tool } from "@furrow/document";
import type * as React from "react";
import { createContext, useContext } from "react";
import type { ToolChoice } from "@/lib/tools";

const ToolLibraryContext = createContext<ToolChoice[]>([]);

/** The signed-in user's tool library, as loaded with the workspace. */
export function ToolLibraryProvider({
  tools,
  children,
}: {
  tools: ToolChoice[];
  children: React.ReactNode;
}) {
  return <ToolLibraryContext value={tools}>{children}</ToolLibraryContext>;
}

export function useToolLibrary() {
  return useContext(ToolLibraryContext);
}

/** The tool new operations start with: the default one, else the first. */
export function defaultToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  return tools.find((choice) => choice.isDefault) ?? tools[0];
}

/** The tool new drill operations start with: the default one if it can drill, else the first that can. */
export function drillToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  const fallback = defaultToolChoice(tools);
  return fallback && canDrill(fallback.tool)
    ? fallback
    : tools.find((choice) => canDrill(choice.tool));
}

/**
 * The library tool an operation's snapshot was taken from, if it hasn't been
 * edited since. Snapshots and choices are both parsed by `Tool`, so their
 * keys come in the same order.
 */
export function matchingToolChoice(tools: ToolChoice[], tool: Tool): ToolChoice | undefined {
  const snapshot = JSON.stringify(tool);
  return tools.find((choice) => JSON.stringify(choice.tool) === snapshot);
}
