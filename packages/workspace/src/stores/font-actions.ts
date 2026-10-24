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
