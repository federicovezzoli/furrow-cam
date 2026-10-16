/** Picked in turn for new tools, so each one is told apart in the preview without choosing a colour. */
export const TOOL_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
] as const;

/** The first palette colour no tool uses yet, cycling once all are taken. */
export function nextToolColor(tools: { color: string }[]): string {
  const used = new Set(tools.map((tool) => tool.color));
  return (
    TOOL_COLORS.find((color) => !used.has(color)) ?? TOOL_COLORS[tools.length % TOOL_COLORS.length]
  );
}
