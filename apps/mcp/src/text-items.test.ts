import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont, textPaths } from "@furrow/cam-core";
import { createProjectDocument, ProjectDocument, type TextSettings } from "@furrow/document";
import { FONTS } from "@furrow/workspace/lib/fonts";
import { createDocumentStore } from "@furrow/workspace/stores/document-store";
import { addTextItem, moveDrawing } from "@furrow/workspace/stores/geometry-actions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { change, createProjects, type Project, type Projects, ToolError } from "./projects";
import { addText, editText } from "./text-items";

let dir: string;
let projects: Projects;
let project: Project;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  projects = createProjects();
  project = await projects.create(join(dir, "Sign.furrow"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const doc = () => project.store.getState().document;
const textOf = (id: string) => doc().drawings.find((d) => d.id === id)?.text;
const pathsOf = (id: string) => doc().geometry.find((s) => s.drawingId === id)?.paths;
const arvo = fileURLToPath((FONTS.find((font) => font.id === "arvo") as { url: URL }).url);

describe("addText", () => {
  it("adds the text item the app's action adds for the same settings", async () => {
    const { id } = await addText(project, { text: "Rossi", font: "Arvo", height: 30 });

    const settings: TextSettings = {
      text: "Rossi",
      font: "arvo",
      height: 30,
      align: "left",
      lineSpacing: 1.7,
      letterSpacing: 0,
      placement: { position: [0, 0], rotation: 0, mirrored: false },
    };
    const app = createDocumentStore(createProjectDocument());
    const font = parseFont(await readFile(arvo));
    const added = addTextItem(app, settings, textPaths(font, settings));
    if (!added.ok) throw new Error("not added");
    const appDoc = app.getState().document;
    expect(textOf(id)).toEqual(appDoc.drawings[0]?.text);
    expect(pathsOf(id)).toEqual(appDoc.geometry[0]?.paths);
    expect(doc().drawings[0]?.name).toBe("Rossi");
    expect(ProjectDocument.safeParse(doc()).success).toBe(true);
  });

  it("puts the text's origin at position", async () => {
    const { id } = await addText(project, { text: "A", position: [40, 25] });
    expect(textOf(id)?.placement.position).toEqual([40, 25]);
    expect(textOf(id)?.font).toBe("jetbrains-mono");
  });

  it("refuses unknown fonts and invalid settings, changing nothing", async () => {
    await expect(addText(project, { text: "A", font: "Comic" })).rejects.toThrow(/no font "Comic"/);
    await expect(addText(project, { text: "  " })).rejects.toThrow(ToolError);
    await expect(addText(project, { text: "A", letterSpacing: -1 })).rejects.toThrow(
      /letterSpacing/,
    );
    expect(doc().drawings).toEqual([]);
  });

  it("adds a font file to the project, saved with it", async () => {
    const { id } = await addText(project, { text: "Hi", fontFile: arvo, singleStroke: false });
    const [font] = doc().fonts;
    expect(font).toMatchObject({ fileName: "Arvo-Regular.ttf", name: "Arvo", singleStroke: false });
    expect(textOf(id)?.font).toBe(font?.sha256);
    await projects.save(project);
    const reopened = await createProjects().open(project.path);
    expect(reopened.fonts.get(font?.sha256 ?? "")?.byteLength).toBe(font?.size);

    // Found again by its hash, without the file.
    expect((await addText(project, { text: "Yo", font: font?.sha256 })).id).toBeTruthy();
    await expect(addText(project, { text: "A", font: "Arvo", fontFile: arvo })).rejects.toThrow(
      /not both/,
    );
  });

  it("keeps a project font's single-stroke flag unless told otherwise", async () => {
    await addText(project, { text: "A", fontFile: arvo, singleStroke: true });
    await addText(project, { text: "B", fontFile: arvo });
    expect(doc().fonts.map((font) => font.singleStroke)).toEqual([true]);
    await addText(project, { text: "C", fontFile: arvo, singleStroke: false });
    expect(doc().fonts.map((font) => font.singleStroke)).toEqual([false]);
  });

  it("refuses a fifth font, changing nothing", async () => {
    const fonts = Array.from({ length: 4 }, (_, i) => ({
      sha256: String(i).repeat(64),
      fileName: `f${i}.ttf`,
      name: `F${i}`,
      size: 1,
      singleStroke: false,
    }));
    project.store.setState((state) => ({ document: { ...state.document, fonts } }));
    await expect(addText(project, { text: "A", fontFile: arvo })).rejects.toThrow(/at most 4/);
    expect(doc().drawings).toEqual([]);
    expect(doc().fonts).toEqual(fonts);
  });

  it("refuses a file that isn't a font", async () => {
    await expect(
      addText(project, { text: "A", fontFile: join(dir, "Sign.furrow") }),
    ).rejects.toThrow(/isn't a font/);
    expect(doc().fonts).toEqual([]);
  });
});

describe("editText", () => {
  it("lays the text out again, keeping its place, and moves it to position", async () => {
    const { id } = await addText(project, { text: "A", position: [10, 10] });
    const before = pathsOf(id);
    expect(await editText(project, id, { text: "AB", align: "right" })).toEqual({
      removedTabs: 0,
    });
    expect(textOf(id)).toMatchObject({ text: "AB", align: "right", height: 20 });
    expect(textOf(id)?.placement.position).toEqual([10, 10]);
    expect(pathsOf(id)).not.toEqual(before);

    await editText(project, id, { position: [50, 30], font: "Pacifico" });
    expect(textOf(id)?.placement.position).toEqual([50, 30]);
    expect(textOf(id)?.font).toBe("pacifico");
  });

  it("keeps a move made while it lays the text out", async () => {
    const { id } = await addText(project, { text: "A", position: [10, 10] });
    const editing = editText(project, id, { text: "AB" });
    change(project, (store) => moveDrawing(store, id, [5, 0]));
    await editing;
    expect(textOf(id)).toMatchObject({ text: "AB", placement: { position: [15, 10] } });
  });

  it("refuses what isn't a text item", async () => {
    await expect(editText(project, "nope", { text: "B" })).rejects.toThrow(/no text item/);
  });
});
