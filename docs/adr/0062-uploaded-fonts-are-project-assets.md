# ADR-0062: Uploaded fonts are project assets, listed in the document like models

- **Status:** Proposed
- **Date:** 2026-10-24
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0010 (T7), ADR-0028, ADR-0029, ADR-0045, ADR-0047, ADR-0050, ADR-0059, ADR-0061; #352

## Context

PRD-0010 T7 lets a user upload a TTF, OTF or WOFF font into a project. A text item names its font by id (ADR-0059): today one of the bundled fonts (#349). Fonts are tens of kilobytes to a few megabytes, too large to copy into the document and each of its versions, as meshes were (ADR-0029). The mesh storage already holds files by hash: the `ProjectAsset` table, its objects in S3, the presigned transfers and the sweep know nothing of meshes, while what decides which hashes a document uses, the limits, the archive layout and the hosts' interface (ADR-0045) are written for meshes.

## Options considered

1. **A font list in the document, beside the models.** `document.fonts` lists `{ sha256, fileName, name, size, singleStroke }`, and a text item's `font` is a bundled id or one of those hashes. Pros: the panel shows a font's name without downloading it; every check of which assets a document uses reads two lists; a text item and the font it uses are validated together. Cons: a schema version, and a font no text uses any more stays listed until removed.
2. **The hash in the text settings only.** Pros: no new list. Cons: nothing to show until the font is downloaded, every check scans text items, and whether the font is single-stroke has nowhere to live.

## Decision

Option 1.

- **Document:** `fonts` lists the project's uploaded fonts by the SHA-256 of their file, with its name, the family name the font gives, its size, and whether it is single-stroke, which the user says on upload: it can't be read from the file (ADR-0061). A text item's `font` that is a hash must be listed. A project holds at most 4 fonts of at most 5 MB each.
- **Storage (web):** an uploaded font is a `ProjectAsset` like a mesh (ADR-0029): the same table, key, presigned upload with its checksum, verification and download. The server checks the size against the font limit and never parses the file; the browser parses it before uploading (`parseFont`). A save is refused while the document references a hash without a verified row, fonts as models; versions rely on the project keeping its assets (ADR-0029). A font is discarded only if neither the document nor a version lists it. Deleting a project deletes its fonts; opening a version as a project copies them. Fonts are cached in the browser by hash, as meshes are.
- **Hosts:** `WorkspaceHost` gains `fonts`, with `put`, `get` and `discard` as for meshes, and `limits.fonts`, `null` where nothing can store them (a web instance without storage).
- **Guest and desktop:** the guest's IndexedDB keeps fonts in the store that keeps meshes, keyed by project and hash as they are, since a hash names one file: deleting a project deletes them, and the database needs no upgrade. A `.furrow` file carries them.
- **Archives:** `fonts/<sha256>` beside `meshes/<sha256>.stl`, deflated (fonts compress, unlike STL meshes), at most 4 counting those only versions list, each at most 5 MB and checked against its hash. A project with models or fonts exports as a `.furrow.zip`; one with neither still exports as `.furrow.json`.

## Consequences

- Uploaded fonts work offline in the desktop app and for guests, and move with a project between the apps.
- A font a project no longer uses stays in it, and in its archives, until the user removes it.
- An instance without storage can't take uploaded fonts, as it can't take models.
