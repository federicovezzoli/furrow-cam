# ADR-0096: The simulator reads the posted program back, in `@furrow/post`

- **Status:** Accepted
- **Date:** 2026-11-28
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0006, ADR-0004, ADR-0019, ADR-0042, ADR-0060, ADR-0091, ADR-0092; issues #682, #683, #684. Supersedes ADR-0042's *Package* and *Dialect*.

## Context

ADR-0042 designed a simulation of the program the machine runs, parsed from its text, and was only partly built: the tool comment and the simulator page shipped, but the simulator plays the toolpaths back (#100), so the post-processor, the work offset, the tool changes and the machine's custom blocks go unchecked in it. Since then `@furrow/post` has learned to read its programs back (`post/src/read-back`, ADR-0092): the e2e corpus (#149) and the export's custom block check (#179) parse `G0`/`G1` with it. A second dialect, Marlin, shares the program writer (ADR-0091).

## Decision

The simulator plays the posted program, read back as ADR-0042 describes, with two changes:

- **Package.** The reader is `programCuts` in `post/src/read-back/program-cuts.ts`, next to the parser it builds on, not a new `@furrow/gcode` package. It depends only on `cam-core` and `document`, so it runs in the toolpath worker that already posts the program (ADR-0004). It returns one `SimulationCut` per `(Furrow tool: …)` comment in stock coordinates, rapids included (ADR-0019), the line of every segment, where each `(Operation: …)` comment starts, and its warnings.
- **Dialect.** Both of our dialects, GRBL 1.1 and Marlin: `( … )` and `;` comments and Marlin's `M0 message` and `M117 message`. Hand-written lines are tidied as GRBL reads them (`g0z5`, `X.5`). On top of ADR-0042's list, the reader:
  - follows `G2`/`G3` with `I J K` (offsets from the start, GRBL's only mode) or `R`, in `G17`–`G19`, helices included, split into chords within the chord tolerance (0.01 mm). An arc with only its centre is a full circle, as Marlin reads it. An arc whose centre isn't given, whose end point is off its circle by more than GRBL allows (0.005 mm and 0.1 %), or that would take more than 100,000 chords, stops the reading;
  - treats `G28`, `G30`, probing (`G38.x`), tool length offsets (`G43`, `G43.1`), `G92`, `G92.1` and the work systems `G55`–`G59` like `G53`, except that no axis is known after them, with an `unknownPosition` warning;
  - skips `G4`, `G40`, `G49`, `G54`, `G61`, `G64`, `G80`, `G91.1`, `G93`, `G94`, the `M` codes our programs and typical blocks write (`M0`–`M9`, `M30`, `M117`, `M400`) and `F S T N P H` without a warning, since they don't move the tool; any other word is an `unsupported` warning.

A move that makes every axis known again after an unknown position is swept from above the stock top straight down to its end point, as ADR-0042 says. A feed from an unknown position, a move before any tool comment, a tool comment that doesn't give a cutter (a V-bit needs its angle, a tapered ball end mill its tip and taper, in the document's ranges), axis words with no motion mode and a line that isn't G-code stop the reading with a `ProgramReadError` naming its line.

ADR-0042's tool comment, interpreter, route and UI stand. Which part of the simulator plays the program is #683; the program panel is #684.

## Consequences

- For every program in the e2e corpus, the stock the program leaves matches the one its toolpaths leave to within one heightmap cell; the corpus test checks it, so a post that drifts from its toolpaths fails CI.
- `parseGcode`'s per-line reader (`parseGcodeLine`) and `tidy` are shared by the export's custom block check and the simulator; `gcodeMoves` is unchanged.
- Warnings carry a code and the word, not a message: the UI translates them (ADR-0054).
- Spindle state isn't followed: a cut with the spindle off isn't reported yet. The e2e checker still checks it for our own programs.
