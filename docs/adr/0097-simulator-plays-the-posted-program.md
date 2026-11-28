# ADR-0097: The simulator plays the program posted from the toolpaths ready

- **Status:** Accepted
- **Date:** 2026-11-28
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0006, ADR-0004, ADR-0019, ADR-0042, ADR-0045, ADR-0060, ADR-0096; issue #683

## Context

ADR-0096 reads a posted program back into the cuts the playback sweeps. The simulator still played the toolpaths (#100): it built its cuts from the toolpath lines and drew each operation's toolpath trailing the tool, part by part. Playing the program instead raises three questions: which program, when an operation's toolpath failed; how the timeline's parts and the trailing toolpaths follow the program's moves, which add retracts, tool changes and the machine's blocks, and lose moves rounding leaves out; and when to post it again.

## Decision

- **Which program.** The toolpath worker posts the program from the toolpaths it holds, as Export does (#133), and reads it back there (`readBack`), off the main thread (ADR-0004). It posts only the operations whose toolpaths are ready: a failed toolpath is left out and named, as before, rather than stopping the simulation. With every toolpath ready, the program is the one Export downloads. In a two-sided project, the side shown plays its own program, the bottom side over the top side's (ADR-0060); only the programs the side shown plays are read back (`playedFiles`).
- **Parts.** The post says where it wrote each step (`ProgramStep`: the operation, whether clearing, the step's first line and the line of each of its moves), returned with each file. A part runs from its step's first line to the next step's; the first takes the program's start, the last its end. A part counts how much of its toolpath is done from the lines its moves went to, so the trailing toolpath stops where the program is, retracts and tool changes included. This replaces the `(Operation: …)` comments ADR-0096 returns as parts, which a machine's custom `operationStart` block leaves out and which can't tell two operations of the same name apart.
- **When.** The program is posted again whenever the toolpaths of the side played, the machine or the stock change, one request at a time; the last program keeps playing meanwhile, paused, as it did while toolpaths recomputed.
- **Saying so.** What reading back said shows under the timeline: why the program can't be posted, or the line it can't be read past and why, and its first three warnings, with their lines, and how many more.

## Consequences

- The simulator shows what the machine runs: a machine block that plunges into the stock cuts it; a program that can't be read says where.
- Editing the machine's blocks or the stock's zero posts the program again, which toolpath playback never needed.
- `GcodeFile` gains `side` and `steps`; the step lines cost one number per move.
- The program's text reaches the main thread with each export only; the program panel (#684) adds it to the simulation.
