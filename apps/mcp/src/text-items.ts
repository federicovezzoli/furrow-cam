import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { type Font, fontName, parseFont, textPaths } from "@furrow/cam-core";
import {
  DEFAULT_LINE_SPACING,
  MAX_FONT_BYTES,
  MAX_PROJECT_FONTS,
  type Path,
  type ProjectFont,
  sha256Hex,
  TextSettings,
} from "@furrow/document";
import { DEFAULT_FONT, DEFAULT_TEXT_HEIGHT, FONTS } from "@furrow/workspace/lib/fonts";
import { FONT_UNAVAILABLE, TEXT_LAYOUT_FAILED } from "@furrow/workspace/lib/text-layout";
import { addFont, setFontSingleStroke } from "@furrow/workspace/stores/font-actions";
import { addTextItem, moveDrawing, setTextItem } from "@furrow/workspace/stores/geometry-actions";
import { text } from "./drawings-and-models";
import { change, type Project, ToolError } from "./projects";
import { parsed } from "./setup";

/** A text item's settings as an assistant gives them; those left out are the app's defaults, or stay as they are. */
export type TextRequest = Partial<Omit<TextSettings, "placement">> & {
  /** Where its origin (the first line's baseline at the alignment) goes, in stock coordinates. */
  position?: [number, number];
  /** Absolute path of a TTF, OTF or WOFF file to add to the project and set the text in. */
  fontFile?: string;
  /** Whether `fontFile` is single-stroke (ADR-0062). */
  singleStroke?: boolean;
};

/** A font file to add to the project with the change, as the app's upload does (`uploadFont`). */
type NewFont = { listing: ProjectFont; bytes: Uint8Array };

/** The bundled fonts parsed, by id: the server lays text out itself, as the app's text worker does. */
const bundled = new Map<string, Promise<Font>>();

/**
 * Reads the font file at `path` as the app's upload checks it: size and
 * readable (`listFont` checks there is room for it). A font the project
 * holds keeps its single-stroke flag unless `singleStroke` is given.
 */
async function readFontFile(project: Project, path: string, given: boolean | undefined) {
  if (!isAbsolute(path)) throw new ToolError(`Give an absolute path, not ${JSON.stringify(path)}.`);
  let bytes: Uint8Array;
  const tooLarge = () =>
    new ToolError(
      text({ code: "workspace.fontTooLarge", values: { mb: MAX_FONT_BYTES / 1_000_000 } }),
    );
  try {
    // Not a pipe or device, which reports no size and may never end.
    const info = await stat(path);
    if (!info.isFile()) throw new ToolError(`${JSON.stringify(path)} isn't a file.`);
    if (info.size > MAX_FONT_BYTES) throw tooLarge();
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Can't read ${path}: ${(error as Error).message}`);
  }
  // It may have grown since `stat`.
  if (bytes.byteLength > MAX_FONT_BYTES) throw tooLarge();
  const sha256 = await sha256Hex(bytes);
  const { fonts } = project.store.getState().document;
  const listed = fonts.find((font) => font.sha256 === sha256);
  const singleStroke = given ?? listed?.singleStroke ?? false;
  const font = readFont(bytes, singleStroke);
  const fileName = basename(path);
  const listing: ProjectFont = listed
    ? { ...listed, singleStroke }
    : {
        sha256,
        fileName,
        name: fontName(font) || fileName.replace(/\.[^.]*$/, ""),
        size: bytes.byteLength,
        singleStroke,
      };
  return { id: sha256, font, added: { listing, bytes } satisfies NewFont };
}

function readFont(bytes: Uint8Array, singleStroke: boolean): Font {
  try {
    return parseFont(bytes, singleStroke);
  } catch {
    throw new ToolError(text({ code: "workspace.fontUnreadable" }));
  }
}

/** Font `given` (a bundled font's id or name, or one of the project's by name or hash): its id and the font. */
async function findFont(project: Project, given: string): Promise<{ id: string; font: Font }> {
  const shipped = FONTS.find((font) => font.id === given || font.name === given);
  if (shipped) {
    let font = bundled.get(shipped.id);
    if (!font) {
      font = readFile(shipped.url).then((bytes) =>
        parseFont(bytes, shipped.kind === "singleStroke"),
      );
      font.catch(() => bundled.delete(shipped.id));
      bundled.set(shipped.id, font);
    }
    try {
      return { id: shipped.id, font: await font };
    } catch {
      throw unavailable();
    }
  }
  const { fonts } = project.store.getState().document;
  const listed = fonts.find((font) => font.sha256 === given || font.name === given);
  if (!listed) {
    const names = new Set([...FONTS.map((font) => font.name), ...fonts.map((font) => font.name)]);
    throw new ToolError(
      `There's no font ${JSON.stringify(given)}: use one of ${[...names].join(", ")}, a project font's sha256 from the summary, or give fontFile.`,
    );
  }
  const bytes = project.fonts.get(listed.sha256);
  if (!bytes) throw unavailable();
  return { id: listed.sha256, font: readFont(bytes, listed.singleStroke) };
}

const unavailable = () => new ToolError(text(FONT_UNAVAILABLE));

/** `request` applied to `base`, validated, its font found or read, and laid out at `base`'s placement. */
async function prepare(project: Project, base: TextSettings, request: TextRequest) {
  const { position, fontFile, singleStroke, ...edits } = request;
  if (fontFile && edits.font) throw new ToolError("Give font or fontFile, not both.");
  if (!fontFile && singleStroke !== undefined) {
    throw new ToolError("singleStroke is said of a fontFile: give it with one.");
  }
  const { id, font, added } = fontFile
    ? await readFontFile(project, fontFile, singleStroke)
    : { ...(await findFont(project, edits.font ?? base.font)), added: undefined };
  const settings = parsed(TextSettings, { ...base, ...edits, font: id });
  let paths: Path[];
  try {
    paths = textPaths(font, settings);
  } catch {
    throw new ToolError(text(TEXT_LAYOUT_FAILED));
  }
  return { settings, paths, added, position };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

/**
 * Prepares `request` from `base()` and commits it with `commit`, inside a
 * `change` that also lists its font file. Prepared again if the text item or
 * the project's fonts changed while the font loaded (another tool call moved
 * it, or listed the same font file with another single-stroke flag), as the
 * app's edit queue does; nothing is awaited between that check and the change.
 */
async function commitSettled(
  project: Project,
  base: () => TextSettings,
  request: TextRequest,
  commit: (prepared: Prepared) => void,
) {
  for (;;) {
    const { fonts } = project.store.getState().document;
    const from = base();
    const prepared = await prepare(project, from, request);
    if (project.store.getState().document.fonts !== fonts || base() !== from) continue;
    const { added } = prepared;
    change(project, (store) => {
      if (added && !addFont(store, added.listing)) {
        throw new ToolError(
          text({ code: "workspace.tooManyFonts", values: { max: MAX_PROJECT_FONTS } }),
        );
      }
      if (added) setFontSingleStroke(store, added.listing.sha256, added.listing.singleStroke);
      commit(prepared);
    });
    if (added) project.fonts.set(added.listing.sha256, added.bytes);
    return;
  }
}

/** Moves text item `id` so its origin lands at `position`, inside a `change`. */
function place(project: Project, id: string, position: [number, number] | undefined) {
  const at = project.store.getState().document.drawings.find((d) => d.id === id)?.text?.placement;
  if (!position || !at) return;
  moveDrawing(project.store, id, [position[0] - at.position[0], position[1] - at.position[1]]);
}

/**
 * Adds a text item to `project` as the app's *Text* does (PRD-0010 T1): the
 * app's settings but those given, placed like an imported drawing unless
 * `position` says where. Returns its drawing's id.
 */
export async function addText(project: Project, request: TextRequest & { text: string }) {
  const base: TextSettings = {
    text: request.text,
    font: DEFAULT_FONT,
    height: DEFAULT_TEXT_HEIGHT,
    align: "left",
    lineSpacing: DEFAULT_LINE_SPACING,
    letterSpacing: 0,
    placement: { position: [0, 0], rotation: 0, mirrored: false },
  };
  let id = "";
  await commitSettled(
    project,
    () => base,
    request,
    ({ settings, paths, position }) => {
      const result = addTextItem(project.store, settings, paths);
      if (!result.ok) throw new ToolError(text(result.error));
      id = result.id;
      place(project, id, position);
    },
  );
  return { id };
}

/**
 * Changes text item `id`'s settings as its properties do (PRD-0010 T3),
 * keeping its placement and the operations machining it, then moves it to
 * `position` if given. Returns how many profile tabs went with its old outlines.
 */
export async function editText(project: Project, id: string, request: TextRequest) {
  const current = () => {
    const drawing = project.store.getState().document.drawings.find((d) => d.id === id);
    if (drawing?.text) return drawing.text;
    throw new ToolError(
      drawing
        ? `${JSON.stringify(id)} is a drawing, not a text item.`
        : `The project has no text item ${JSON.stringify(id)}.`,
    );
  };
  let removedTabs = 0;
  await commitSettled(project, current, request, ({ settings, paths, position }) => {
    const result = setTextItem(project.store, id, settings, paths);
    if (!result.ok) throw new ToolError(text(result.error));
    removedTabs = result.removedTabs;
    place(project, id, position);
  });
  return { removedTabs };
}
