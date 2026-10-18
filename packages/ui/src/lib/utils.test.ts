import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges the workspace's font sizes as sizes, not colours", () => {
    expect(cn("text-sm text-primary-foreground", "text-ui")).toBe(
      "text-primary-foreground text-ui",
    );
    expect(cn("text-ui", "text-ui-label")).toBe("text-ui-label");
  });

  it("merges the control spacing with other sizes", () => {
    expect(cn("h-control", "h-auto")).toBe("h-auto");
    expect(cn("size-control", "size-control-sm")).toBe("size-control-sm");
  });
});
