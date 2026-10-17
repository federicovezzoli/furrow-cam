# ADR-0042: Simulating the G-code program parsed from its text

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0006, PRD-0001 (R10, R11), ADR-0004, ADR-0011, ADR-0014, ADR-0016, ADR-0019, ADR-0021, ADR-0041

## Context

The workspace simulates material removal (ADR-0019) from the toolpaths' line segments. That checks the toolpath generator and nothing after it: the post-processor, the work offset (ADR-0014, ADR-0016), retracts, tool changes, the touch-off pad (ADR-0041) and the machine's custom blocks, which are copied into the program verbatim and may contain `G91`, `G53` or `M6`. PRD-0006 asks for a simulation of the program the machine will run.

There is no G-code parser: `@furrow/post` only writes G-code. The GRBL post writes `G0`/`G1` only, in work coordinates, and at each tool change a readable `(Tool: <name>, <diameter> mm)` comment and an `M0` (or the machine's tool-change block). That comment doesn't give the cutter's shape, which the heightmap sweep needs (`CutterShape`: type, diameter, V angle, tip diameter).

G-code is derived data and isn't stored (ADR-0003, ADR-0004). Since #133, the workspace posts the program from the toolpaths it has already computed, so generating it on demand is cheap. Programs for 3D reliefs can run to tens of MB.

## Options considered

**Source of the program**

1. **Generate on demand** from the open document, the same bytes Export downloads. Nothing to store.
2. **Also open a local `.nc` file.** This checks programs from elsewhere, but needs the user to describe the tools, and it widens the dialect the parser must cope with.
3. **Persist the last exported program.** Contradicts ADR-0004 and stores tens of MB per relief project.

**Cutter shape for each move**

1. **Match tool changes to the document's operations** in program order. This needs no change to the export, but checks less: a post that wrote the wrong tool change would still be simulated with the right cutter.
2. **A machine-readable tool comment** written by the post and read back. The program describes itself and is checked on its own.
3. **Ask the user** every time. Adds friction for our own programs.

**Words the parser doesn't support:** an error stops the simulation on any program with an unusual word in a custom block; a warning skips the word and says so.

**Where it lives:** inside `@furrow/post` (reading next to writing), or a new package.

**UI:** a toggle on the existing simulation in the workspace, or its own route with room for the program text.

## Decision

**Source.** The simulation runs on the program generated on demand from the open document, posted from the toolpaths the workspace already computed (#133), the same bytes Export downloads. Nothing is stored. Opening outside files is out of scope for now (PRD-0006 non-goals).

**Tool comment.** At each tool change, including the first tool, the GRBL post writes a machine-readable comment next to the readable one, with the `CutterShape` fields as `key=value` pairs in millimetres and degrees, omitting fields that don't apply:

```
(Tool: 1/4" ball, 6.35 mm)
(Furrow tool: type=ball_end_mill diameter=6.35)
(Furrow tool: type=v_bit diameter=12 vAngle=60 tipDiameter=0.2)
```

GRBL ignores comments, so the program runs the same. The interpreter takes the cutter from the last such comment. A cutting move before any such comment, or a comment that doesn't parse, is an error. Every program we simulate comes from our post, so either case means a bug in it.

**Dialect.** The parser covers the GRBL 1.1 subset that our post and typical custom blocks use:

- motion: `G0`, `G1`, and `G2`/`G3` with `I J K` or `R`, split into chords within a fixed tolerance in the active plane (`G17`–`G19`);
- modes: `G20`/`G21` (inches are converted to millimetres), `G90`/`G91`, `G94`;
- `G53`: a `G53` Z move is a retract to above the stock. A `G53` XY move makes the position unknown until the next absolute XY move, and a cutting move from an unknown position is an error;
- `M0`, `M3`, `M5`, `M6`, `M30`, and the words `F`, `S`, `T`, `N`;
- comments, both `( … )` and `; …`.

Any other word is skipped, with a warning that gives its line number. A line that doesn't parse (a word without a number, an arc whose radius can't reach its end point) stops the simulation with its line number.

**Interpreter.** It replays the program in work coordinates and converts each move into stock coordinates with the stock's work offset (`stockOffset`, ADR-0014, ADR-0016). The result is one `SimulationCut` per tool comment, with one segment per move, rapids included, as ADR-0019 says. Each segment keeps the line it came from, for playback. The spindle state doesn't change what cuts: ADR-0019 counts every move, so a move into the stock with the spindle off is reported as a warning, not skipped.

**Package.** The parser and interpreter go in a new `@furrow/gcode` package. It depends on `@furrow/cam-core` for `CutterShape`, `SimulationCut` and `stockOffset`, and is consumed by `web`. `@furrow/post` uses it only in its tests, to check that exported programs read back as the same moves. The dependency direction becomes `web → post → cam-core → document` and `web → gcode → cam-core` (ADR-0011). Reading G-code is a different job from writing it: a separate package keeps each one small, and it could serve a future `.nc` importer.

**Where it runs.** Parsing, interpreting and the heightmap all run in a Web Worker (ADR-0004). Playback applies the sweep (`sweepMoves`) to a prefix of the moves, as ADR-0019 anticipated.

**UI.** The simulation gets its own route, `/projects/[id]/gcode`, opened by a button next to Export G-code. The workspace's providers and stores move into a layout for `/projects/[id]`, so the toolpaths already computed survive the navigation both ways. When the route is opened directly, it computes them first. The page shows:

- the program text with line numbers, virtualised so that programs of tens of MB scroll smoothly;
- a viewport with the simulated stock and the tool, drawn with its shape and diameter;
- a timeline with play/pause, speed and scrubbing; the line being played is highlighted, and clicking a line jumps to it;
- the parser's warnings, each linking to its line.

## Consequences

- What the simulation shows is what the post wrote: a wrong offset, a missing retract, a tool change with the wrong cutter or a custom block that plunges into the stock all show up in the stock or as warnings.
- Toolpath generation and the post share `stockOffset`, so a bug in it shifts both simulations the same way and isn't caught by comparing them.
- Exported programs gain one comment per tool change. The format is ours, so it can change; we'll version it only if outside tools start reading it.
- Playback in the workspace (#100) and on this route need the same incremental heightmap and timeline. They should share one implementation fed by different move lists.
- Moving the workspace's providers into a layout touches every workspace component that reads the stores, but not their behaviour.
- Opening outside `.nc` files would build on the same parser, adding a way to pick a cutter for programs without our tool comment.
