# ADR-0090: G-code dialects share one program; Marlin is the second

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R11, R12), PRD-0004, ADR-0042, ADR-0043, ADR-0056, ADR-0065

## Context

Only GRBL had a post-processor (`packages/post/src/grbl/`). V1 Engineering's MPCNC and LowRider, which the presets aim at, often run Marlin, and PRD-0004 listed them as unsupported. PRD-0001 R12 asks for other dialects to plug in (#578).

Marlin reads most of what the GRBL post writes, but differs in ways that make a GRBL program unsafe or wrong there (Marlin 2.1 documentation):

- It runs only the first G-code on a line, so `G21 G90 G94 G17` sets millimetres and nothing else.
- `( … )` comments need `PAREN_COMMENTS`; `;` comments always work.
- `G4 P` is in milliseconds; `G4 S` is in seconds.
- `M30` deletes a file on the SD card.
- Without `G0_FEEDRATE`, `G0` runs at the last `F`: a rapid after a 300 mm/min plunge crawls, and a cut after a rapid that set `F` runs at the rapid's feed.
- `M3`/`M5` work only with `SPINDLE_FEATURE`; V1 builds usually switch the router by hand. `M3 S` is in RPM only with `CUTTER_POWER_UNIT RPM`; the default, `PWM255`, clamps an RPM to full power.
- `M0` shows the rest of its line on the LCD.

No Marlin machine was at hand to check this on (the issue's spike): the post follows the documentation and is **not yet verified on hardware**.

More dialects will follow (grblHAL and FluidNC already read GRBL; LinuxCNC, Mach3/4, UCCNC and Masso have `M6`, tool length offsets and canned cycles), so how dialects share code matters more than Marlin itself.

## Options considered

1. **Copy `grbl/` into `marlin/` and edit it.** Quick, but the program's shape (header, tool changes, spin-up, custom blocks, read-back) would be maintained twice, and every fix would need porting.
2. **One shared program, with the dialect's differences as data and small functions** (`Dialect`: comment, modes, dwell, pause, end, rapids' feed). GRBL and Marlin fill one in each.
3. **A generic hook for every step** (tool change, moves, end…), each dialect overriding what it needs. Covers LinuxCNC too, but builds hooks no dialect uses yet.

## Decision

Option 2.

- `packages/post/src/program.ts` writes the program in any `Dialect`; `grbl/` and `marlin/` each hold only their `Dialect` and their `PostProcessor`, which exposes it (`dialect`) so the workspace can show a block in the machine's dialect (the touch-off pad's derived tool change, ADR-0056).
- The shared helpers stay where they are and dialect-agnostic: the G-code writer (which takes the dialect's comment and, for Marlin, the rapids' feed), machine limits, read-back, setup notes, touch-off and the estimate.
- Hooks are added when a dialect needs them, with GRBL's behaviour as the default. A dialect that would replace more than about half of the program (LinuxCNC with `M6` and `G43`, canned cycles for drilling) gets its own program writer that reuses the shared helpers, instead of piling hooks into `program.ts`.
- The pad's derived tool change (ADR-0056) writes one command per line in every dialect. The read-back (`parseGcode`) and the e2e checker read both comment styles and Marlin's `M0 message`; the checker applies the machine's dialect's rules.

Marlin writes `G21` and `G90` on lines of their own (no `G94`, always per minute; no `G17`, no arcs are written), `;` comments, `G4 S`, `M0 <message>`, no `M30` and no `M84` at the end, and every rapid with `F` at the machine's maximum XY feed, so the next cut writes its own feed again. Spindle words are GRBL's, `S` in RPM; a build without `SPINDLE_FEATURE` ignores them.

Documents bump to schema version 43, with no data change, so older releases don't open a project whose machine uses Marlin. The database's `PostProcessor` enum gains `marlin`.

## Consequences

- A new dialect is a folder with a `Dialect`, an entry in `POST_PROCESSORS`, a `PostProcessorId`, a database enum value and corpus projects for the checker.
- GRBL output is unchanged byte for byte: the corpus programs didn't move.
- Until someone runs it on a Marlin machine, the main risks are build options: `G0_FEEDRATE` (harmless either way), `CUTTER_POWER_UNIT` (a controlled spindle needs `RPM`), `M0` needing an LCD or a host to resume, and Marlin reading a tool name in an `M0` message as a parameter.
- The message codes stay `grbl.*` (`grbl.slowed`…): renaming them would touch every catalog for no user-visible change.
- There are no Marlin presets yet (PRD-0004 M3 needs official sources for their values); the V1 Engineering presets' firmware note says how to use them on a Marlin build.
