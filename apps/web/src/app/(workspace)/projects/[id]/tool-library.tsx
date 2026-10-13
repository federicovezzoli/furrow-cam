"use client";

import { canDrill, type Tool } from "@furrow/document";
import type * as React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import type { ToolChoice } from "@/lib/tools";
import { toolKey } from "@/stores/operation-actions";

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

/** The tool new drill operations start with: the default one if it can drill, else the first that can. */
export function drillToolChoice(tools: ToolChoice[]): ToolChoice | undefined {
  const fallback = defaultToolChoice(tools);
  return fallback && canDrill(fallback.tool)
    ? fallback
    : tools.find((choice) => canDrill(choice.tool));
}

/** The library tool an operation's snapshot was taken from, if it hasn't been edited since. */
export function matchingToolChoice(tools: ToolChoice[], tool: Tool): ToolChoice | undefined {
  const key = toolKey(tool);
  return tools.find((choice) => toolKey(choice.tool) === key);
}
