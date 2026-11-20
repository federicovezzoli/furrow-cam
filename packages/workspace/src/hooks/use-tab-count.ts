import { useState } from "react";

/**
 * The count "Place" spreads round each of `loops` contours or models (#618):
 * the `tabs` already placed over the loops, rounded, so exact when every loop
 * has the same number; `fallback` without tabs or loops. A count the user
 * types is kept until that number changes, so dragging a tab keeps it.
 */
export function useTabCount(tabs: number, loops: number, fallback: number) {
  const placed = tabs > 0 && loops > 0 ? Math.max(1, Math.round(tabs / loops)) : fallback;
  const [count, setCount] = useState(placed);
  const [seen, setSeen] = useState(placed);
  if (seen !== placed) {
    setSeen(placed);
    setCount(placed);
  }
  return [count, setCount] as const;
}
