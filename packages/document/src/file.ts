/** Extension of exported project files; their contents are a `ProjectDocument` (ADR-0003). */
export const PROJECT_FILE_EXTENSION = ".furrow.json";

// Reserved on Windows or macOS, or control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it matches
const UNSAFE_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** The file name to export the project `name` as, e.g. `Cutting board.furrow.json`. */
export function projectFileName(name: string): string {
  const base = name
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim()
    // Windows drops trailing dots, and a leading dot hides the file elsewhere.
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return `${base || "project"}${PROJECT_FILE_EXTENSION}`;
}

/**
 * The project name to give an imported file: its name without the
 * extension, or `null` if nothing is left.
 */
export function projectNameFromFileName(fileName: string): string | null {
  const name = fileName.replace(/(\.furrow)?\.json$/i, "").trim();
  return name === "" ? null : name;
}
