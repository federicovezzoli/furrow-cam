# PRD-0006: G-code simulation

- **Status:** Abandoned
- **Author:** Federico Vezzoli
- **Created:** 2026-10-17
- **Related:** PRD-0001 (R10, R11), ADR-0004, ADR-0019, ADR-0042

> **2026-10-17: abandoned after P3 and P7 shipped.** Exported programs name their cutter (P3, #165), and the toolpaths survive moving between the workspace and the simulator (P7, #167). The rest was dropped: the simulator page (#100, #174) plays the toolpaths back move by move, the e2e corpus (#149) checks every exported program in CI, and custom G-code blocks are checked on export (#179). See ADR-0042.

## Problem

The material-removal simulation (PRD-0001 **R10**, ADR-0019) replays the toolpaths, not the program the machine runs. The post-processor, the work offset, the retracts, the tool changes and the machine's custom G-code blocks all go unchecked. To check the program before running it, users have to trust our post-processor or open the file in another tool.

## Users

- Hobby router owners who want to see what the exported file will do before they press start, especially after editing the custom G-code blocks of their machine.

## Goals

- A user sees the program they are about to export cut the stock, line by line, without leaving Furrow CAM.
- A mistake in the program (a wrong offset, a missing retract, a tool change with the wrong cutter, a custom block that plunges into the stock) shows up in the simulation.

## Non-goals

- **Opening outside `.nc`/`.gcode` files.** The parser is built so it could be added later.
- **Storing G-code** (ADR-0004): the program is generated on demand.
- **Dialects other than GRBL 1.1**, e.g. Marlin, LinuxCNC canned cycles, tool length offsets.
- **Editing the program** in the viewer.
- **Machine limits:** checking moves against the machine's work area or soft limits.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| P1 | A **Simulate G-code** button next to **Export G-code** opens a page for the open project's program, the same bytes Export would download, generated on demand and never stored | Must |
| P2 | The program is parsed from its text: GRBL 1.1 moves (including arcs), unit, distance and plane modes, machine-coordinate moves, spindle, pause and tool-change codes. Unsupported words are skipped and listed as warnings with their line numbers; a line that can't be parsed stops the simulation and says which line | Must |
| P3 | Exported programs describe each tool's cutter shape in a comment, so the simulation uses the cutter the program names | Must |
| P4 | The page shows the program text with line numbers next to a 3D view of the stock being cut, using the heightmap simulation (ADR-0019) | Must |
| P5 | Playback: play/pause, speed, scrubbing; the current line is highlighted, and clicking a line jumps there. The tool is drawn with its shape and diameter | Must |
| P6 | Warnings name the line and what was wrong, e.g. a cut with the spindle off, or an unsupported word in a custom block | Must |
| P7 | Going back to the workspace keeps the toolpaths already computed, and so does coming back to the page | Should |
| P8 | Stays responsive for programs of tens of MB (3D reliefs): parsing and simulation run in a worker, and the text is virtualised | Must |

## User flow

1. A user finishes setting up their operations and clicks **Simulate G-code** next to **Export G-code**.
2. The page shows the program and the uncut stock. They press play and watch the tool cut, the current line highlighted.
3. A warning says that line 12 of the custom start block isn't supported. They click it, see the line, fix the block in their machine profile and come back.
4. They return to the workspace and export.

## Success criteria

- For every operation type, the end result of the G-code simulation matches the toolpath simulation of the same project.
- A program whose work offset is wrong, or whose custom block cuts into the stock, visibly differs from the toolpath simulation.

## Open questions

- None at the moment.

## Changelog

- 2026-10-17: created (#134, ADR-0042)
