---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Add an engrave operation (PRD-0001 R21): it follows every selected path on the line, open and closed, or the closed ones inside or outside the line with the tool centre half the groove's width away, so one edge of the groove is on the line (open paths are then skipped with a warning). It cuts to a depth in passes no deeper than the tool's step-down, with an optional ramp in. With a V-bit the line width can be typed instead of the depth, converted from the bit's angle and tip diameter, and a depth past the cone is warned about. V-bits, ball and flat end mills can engrave; drill bits can't. New engravings start on the line, with the first V-bit in the library, 1 mm deep. Documents move to schema version 5 with no changes to existing data. `@furrow/document` adds `EngraveParams`, `EngraveOperation` and `canEngrave`; `@furrow/cam-core` adds `engraveToolpath`, `offsetProfileToolpath`, `grooveWidth`, `vBitLineWidth`, `vBitDepthForWidth` and `vBitConeDepth`. The profile's warning for skipped open paths now reads "inside and outside cuts need closed paths".
