import { describe, expect, it } from "vitest";
import { projectFileName, projectNameFromFileName } from "./file";

describe("projectFileName", () => {
  it("appends the extension", () => {
    expect(projectFileName("Walnut cutting board")).toBe("Walnut cutting board.furrow.json");
  });

  it("replaces characters that aren't allowed in file names", () => {
    expect(projectFileName('Sign: "Home" 1/2')).toBe("Sign- -Home- 1-2.furrow.json");
    expect(projectFileName("tab\there\nnew")).toBe("tab-here-new.furrow.json");
  });

  it("drops leading and trailing dots and spaces", () => {
    expect(projectFileName("  ..hidden.  ")).toBe("hidden.furrow.json");
  });

  it("falls back to a default name", () => {
    expect(projectFileName(" ... ")).toBe("project.furrow.json");
  });
});

describe("projectNameFromFileName", () => {
  it("drops the extension", () => {
    expect(projectNameFromFileName("Cutting board.furrow.json")).toBe("Cutting board");
    expect(projectNameFromFileName("Cutting board.FURROW.JSON")).toBe("Cutting board");
    expect(projectNameFromFileName("sign.json")).toBe("sign");
  });

  it("keeps other extensions", () => {
    expect(projectNameFromFileName("sign.v2.txt")).toBe("sign.v2.txt");
  });

  it("round-trips exported names", () => {
    expect(projectNameFromFileName(projectFileName("Walnut cutting board"))).toBe(
      "Walnut cutting board",
    );
  });

  it("returns null when nothing is left", () => {
    expect(projectNameFromFileName(" .furrow.json")).toBeNull();
  });
});
