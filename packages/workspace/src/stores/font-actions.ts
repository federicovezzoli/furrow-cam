import { MAX_PROJECT_FONTS, type ProjectFont } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Lists uploaded font `font` in the project (ADR-0062), as one undo step.
 * Returns `false`, changing nothing, when the project already holds as many
 * fonts as it may; a font it already lists is left as it is.
 */
export function addFont(store: DocumentStore, font: ProjectFont): boolean {
  const { fonts } = store.getState().document;
  if (fonts.some((listed) => listed.sha256 === font.sha256)) return true;
  if (fonts.length >= MAX_PROJECT_FONTS) return false;
  store.getState().change("addFont", (draft) => {
    draft.fonts.push(font);
  });
  return true;
}

/** Says whether uploaded font `sha256` is single-stroke, as one undo step; nothing if it already says so. */
export function setFontSingleStroke(store: DocumentStore, sha256: string, singleStroke: boolean) {
  store.getState().change("setFont.singleStroke", (draft) => {
    const font = draft.fonts.find((listed) => listed.sha256 === sha256);
    if (font && font.singleStroke !== singleStroke) font.singleStroke = singleStroke;
  });
}
