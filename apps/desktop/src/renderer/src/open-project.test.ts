import { createProjectDocument } from "@furrow/document";
import { writeProjectFile } from "@furrow/workspace/lib/project-file";
import { describe, expect, it, vi } from "vitest";
import { openProjectBytes } from "./open-project";

const document = createProjectDocument();
const project = () =>
  writeProjectFile({
    document,
    meshes: new Map(),
    fonts: new Map(),
    versions: [],
  });

function steps(closes = true) {
  return {
    report: vi.fn(),
    replaceWith: vi.fn(async (next: () => void) => {
      if (closes) next();
    }),
    open: vi.fn(),
  };
}

describe("openProjectBytes", () => {
  it("reports a file that isn't a project and doesn't open it (#494)", async () => {
    const s = steps();
    await openProjectBytes(new TextEncoder().encode("not a project"), "Archivio", s);
    expect(s.report).toHaveBeenCalledWith(expect.stringContaining("Archivio"));
    expect(s.replaceWith).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
  });

  it("opens a project once the open one is closed", async () => {
    const s = steps();
    await openProjectBytes(project(), "Coasters", s);
    expect(s.report).not.toHaveBeenCalled();
    expect(s.open).toHaveBeenCalledWith(expect.objectContaining({ document }));
  });

  it("doesn't open it when closing the open project is cancelled", async () => {
    const s = steps(false);
    await openProjectBytes(project(), "Coasters", s);
    expect(s.open).not.toHaveBeenCalled();
  });
});
