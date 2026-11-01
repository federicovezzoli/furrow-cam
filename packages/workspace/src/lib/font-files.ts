// No imports: the licences page lists these without loading the CAM core.
/**
 * The fonts the app ships (PRD-0010 T4, `src/fonts/README.md`), by the id a
 * text item stores, so a project opens with the same font everywhere. Their
 * files are bundled with the workspace: no font is fetched from the internet.
 * Each ships with its licence, as the SIL Open Font License asks: Arvo's
 * file doesn't carry it.
 */
export const FONTS = [
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    // The interface's font.
    kind: "mono",
    url: new URL("../fonts/JetBrainsMono-Regular.ttf", import.meta.url),
    licence: new URL("../fonts/JetBrainsMono-OFL.txt", import.meta.url),
  },
  {
    id: "arvo",
    name: "Arvo",
    kind: "serif",
    url: new URL("../fonts/Arvo-Regular.ttf", import.meta.url),
    licence: new URL("../fonts/Arvo-OFL.txt", import.meta.url),
  },
  {
    id: "pacifico",
    name: "Pacifico",
    kind: "script",
    url: new URL("../fonts/Pacifico-Regular.ttf", import.meta.url),
    licence: new URL("../fonts/Pacifico-OFL.txt", import.meta.url),
  },
  {
    id: "relief-singleline",
    name: "Relief SingleLine",
    kind: "singleStroke",
    url: new URL("../fonts/ReliefSingleLineCAD-Regular.ttf", import.meta.url),
    licence: new URL("../fonts/Relief-OFL.txt", import.meta.url),
  },
] as const;
