/** Extension of exported project files; their contents are a `ProjectDocument` (ADR-0003). */
export const PROJECT_FILE_EXTENSION = ".furrow.json";

// Reserved on Windows or macOS, or control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it matches
const UNSAFE_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/**
 * The file name to export the project `name` as, e.g. `Cutting board.furrow.json`,
 * or with another `extension` (G-code is `Cutting board.gcode`).
 */
export function projectFileName(name: string, extension = PROJECT_FILE_EXTENSION): string {
  const base = name
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim()
    // Windows drops trailing dots, and a leading dot hides the file elsewhere.
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return `${base || "project"}${extension}`;
}

/**
 * The extension a project's file name ends with, removed to name the
 * project: `.furrow`, `.furrow.json` or `.furrow.zip`, or a plain `.json` or
 * `.zip`, which the web app imports too.
 */
export const PROJECT_FILE_SUFFIX = /(\.furrow)?\.(json|zip)$|\.furrow$/i;

/** Paths the desktop app and the MCP server open as projects: `.furrow`, `.furrow.json` or `.furrow.zip`. */
export const PROJECT_PATH = /\.furrow(\.(json|zip))?$/i;

/**
 * The project name to give an imported file (`.furrow.json`, `.furrow.zip`
 * or `.furrow`): its name without the extension, or `null` if nothing is left.
 */
export function projectNameFromFileName(fileName: string): string | null {
  const name = fileName.replace(PROJECT_FILE_SUFFIX, "").trim();
  return name === "" ? null : name;
}
