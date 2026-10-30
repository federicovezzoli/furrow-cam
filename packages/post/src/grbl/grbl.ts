import { activeTouchOff, stockOffset, type Vec3 } from "@furrow/cam-core";
import { machineSpinUpDelay, type Tool, type TouchOff } from "@furrow/document";
import { estimateTime, formatDuration } from "../estimate";
import { formatNumber } from "../format";
import { comment, GcodeWriter } from "../gcode-writer";
import { limitFeed, spindleSpeed } from "../machine-limits";
import {
  type PostInput,
  type PostOutput,
  type PostProcessor,
  type PostStep,
  type PostWarning,
  postSteps,
} from "../post";
import { type BlockLabel, customBlockWarnings } from "../read-back";
import { padLabel, sideSetupLines, xyZeroLabel, zZeroLabel } from "../setup-notes";
import { sameBit, toolLabel, toolShapeComment } from "../tool";
import { fillPlaceholders, suggestTouchOffToolChange, unfilledPlaceholders } from "../touch-off";

/** The modes every coordinate assumes: millimetres, absolute, feed per minute, XY plane. */
const MODES = "G21 G90 G94 G17";

/**
 * GRBL 1.1 (PRD-0001 R11), in millimetres and absolute coordinates, measured
 * from the work origin (ADR-0014, ADR-0016).
 *
 * - The program starts with `MODES` and ends with the spindle off, a rapid up
 *   to the retract height, a rapid to the XY zero and `M30`. Its header
 *   estimates how long it runs (`estimateTime`, #420).
 * - Each operation starts with a comment naming it, rises to the retract
 *   height and only then starts the spindle (`M3`, with `S` unless the
 *   machine has a manual spindle), so it never spins up touching the work.
 *   Every word is written in full: the user may have jogged during a pause.
 * - GRBL doesn't wait for the spindle to reach speed, so a dwell (`G4 P`, the
 *   machine's spin-up delay in seconds) follows each `M3` that starts it or
 *   raises its speed. The spindle counts as stopped after a tool change, and
 *   after a custom operation-start block that stops it or ends or pauses the
 *   program. A manual spindle gets none: it is switched on by hand, and up to
 *   speed when the job runs.
 * - An operation with clearing moves (ADR-0026) is written as two: the
 *   clearing moves with its clearing tool, named "<operation>, clearing",
 *   then its own.
 * - The first tool is assumed loaded. When the next operation's bit differs,
 *   GRBL has no `M6`, so the tool change turns the spindle off, rises and
 *   pauses with `M0`, asking for Z to be zeroed again: there are no tool
 *   length offsets. `MODES` follows the pause, since zeroing Z with a
 *   sender's probe macro or jogging can leave `G91` or `G20` set. It leaves
 *   the work offset (`G54`…) and any `G43.1` alone: the program never sets
 *   them, and a macro's `G43.1` may be how the new bit was zeroed. With a
 *   touch-off pad (ADR-0041), the pad's tool change (ADR-0043) replaces all
 *   of it, its placeholders filled in: the project's own block, or without
 *   one the block derived from the machine's (`suggestTouchOffToolChange`,
 *   ADR-0056), the one the zero section shows.
 * - Each tool's cutter shape is written in a machine-readable comment
 *   (`toolShapeComment`, ADR-0042) when the cutter is in the spindle: for the
 *   first tool in the header, before the program-start block; at a tool
 *   change after the pause or the custom tool-change block.
 * - Feeds are lowered so neither the XY nor the Z component of a move exceeds
 *   the machine's maximum, and spindle speeds are kept in its range; either
 *   warns.
 * - The machine's custom blocks replace the program start, the program end,
 *   the operation comment and the tool change, copied verbatim apart from
 *   their placeholders (`PLACEHOLDERS`); one left unfilled warns. They may move
 *   the tool or change modes (a `G91` retract), so `MODES` and every word are
 *   written again after one, except at the end. The program is read back, and
 *   a move in or after one into the stock warns (`customBlockWarnings`).
 */
export const grbl: PostProcessor = { id: "grbl", extension: ".gcode", post: postGrbl };

/** What writing one program keeps track of, from its header to its end. */
type Program = {
  input: PostInput;
  out: GcodeWriter;
  warnings: PostWarning[];
  pad: TouchOff | null;
  /** Unfilled placeholders already warned about, as `<block> <placeholder>`. */
  said: Set<string>;
  /** The spindle's speed while it is known to be on, else `undefined`. */
  speed: number | undefined;
};

function postGrbl(input: PostInput): PostOutput {
  const { stock, machine, operations } = input;
  const program: Program = {
    input,
    out: new GcodeWriter(stockOffset(stock)),
    warnings: [],
    pad: activeTouchOff(stock),
    said: new Set(),
    speed: undefined,
  };
  const steps = postSteps(operations);
  writeHeader(program, steps);
  let tool: Tool | null = null;
  for (const step of steps) {
    writeTool(program, tool, step.tool);
    tool = step.tool;
    writeOperation(program, step);
  }
  writeEnd(program);

  const gcode = program.out.toString();
  const project = { stock, machine, operations: operations.map(({ operation }) => operation) };
  const { warnings } = program;
  warnings.push(...customBlockWarnings(gcode, project, program.out.customBlocks));
  return { gcode, warnings };
}

/** The name, the setup the user must do, the first tool's shape and the program start. */
function writeHeader(program: Program, steps: PostStep[]) {
  const { out, pad, input } = program;
  const { name, stock, machine, side } = input;
  out.comment(name);
  out.comment("Generated by Furrow CAM");
  if (side) for (const line of sideSetupLines(stock, side, steps[0]?.tool)) out.comment(line);
  out.comment(`Zero: X Y ${xyZeroLabel(stock)}, Z ${zZeroLabel(stock)}`);
  const seconds = input.operations.reduce(
    (total, { toolpath }) => total + estimateTime(toolpath, machine),
    0,
  );
  // Without a machine, rapids have no rate (`estimateTime`).
  const left = machine ? "tool changes" : "rapids or tool changes";
  out.comment(`Estimated time: about ${formatDuration(seconds)}, not counting ${left}`);
  const changesBit = steps.some((step, i) => {
    const before = steps[i - 1];
    return before !== undefined && !sameBit(before.tool, step.tool);
  });
  if (changesBit) {
    out.comment(
      pad
        ? `Zero Z again on the touch-off pad after each tool change: ${padLabel(stock, pad)}`
        : "Zero Z again after each tool change",
    );
  }
  const first = steps[0];
  if (first) out.line(toolShapeComment(first.tool));
  if (machine?.programStart) writeCustom(program, "programStart", machine.programStart);
  else out.line(MODES);
}

/**
 * Names `tool` when it isn't the `previous` bit, and after the first tool
 * swaps it in: the pad's block, the machine's, or a pause to do it by hand.
 */
function writeTool(program: Program, previous: Tool | null, tool: Tool) {
  const { out, pad, input } = program;
  const { machine, safeZ } = input;
  if (previous !== null && sameBit(previous, tool)) return;
  out.comment(`Tool: ${toolLabel(tool)}`);
  if (previous === null) return;
  out.forget();
  // Changing the bit stops the spindle, whatever the blocks write.
  program.speed = undefined;
  if (pad) {
    // The project's own block, else the one derived from the machine's (ADR-0056).
    const block = pad.toolChange ?? suggestTouchOffToolChange(machine?.toolChange ?? null);
    writeCustom(program, "toolChangePad", block);
  } else if (machine?.toolChange) {
    // The block may stop the spindle.
    writeCustom(program, "toolChange", machine.toolChange);
  } else {
    out.line("M5");
    out.rapid({ z: safeZ });
    out.line(`M0 ${comment(`Change the bit to ${toolLabel(tool)} and zero Z again`)}`);
    out.line(MODES);
  }
  out.line(toolShapeComment(tool));
}

/** One step: its start, a rise to the retract height, the spindle, then its moves. */
function writeOperation(program: Program, step: PostStep) {
  const { out, input } = program;
  const { machine, safeZ } = input;
  if (machine?.operationStart) {
    writeCustom(program, "operationStart", machine.operationStart);
    if (stopsSpindle(machine.operationStart)) program.speed = undefined;
  } else out.comment(`Operation: ${step.name}`);

  // Getting to the first entry point safely is the post-processor's job.
  // The user may have jogged during a pause, so nothing is taken as known.
  out.forget();
  out.rapid({ z: safeZ });
  startSpindle(program, step);
  writeMoves(program, step);
}

/** `M3` at the step's speed, kept in the machine's range, and a dwell if it must spin up. */
function startSpindle(program: Program, step: PostStep) {
  const { out, input } = program;
  const rpm = spindleSpeed(step.tool.spindleRpm, input.machine);
  if (rpm.clamped) {
    program.warnings.push({
      operation: step.name,
      message: {
        code: "grbl.spindleClamped",
        values: { rpm: step.tool.spindleRpm, used: rpm.value ?? 0 },
      },
    });
  }
  out.line(rpm.value === null ? "M3" : `M3 S${rpm.value}`);
  const spinUpDelay = machineSpinUpDelay(input.machine);
  // `null` only for a manual spindle, which never waits.
  if (spinUpDelay > 0 && rpm.value !== null) {
    if (program.speed === undefined || rpm.value > program.speed) {
      out.line(`G4 P${formatNumber(spinUpDelay)}`);
    }
    program.speed = rpm.value;
  }
}

/** The step's moves, feeds lowered to the machine's maximums, warning if any was. */
function writeMoves(program: Program, step: PostStep) {
  const { out, input } = program;
  let previous: Vec3 | null = null;
  let clamped = 0;
  for (const move of step.moves) {
    const [x, y, z] = move.to;
    if (move.kind === "rapid") out.rapid({ x, y, z });
    else {
      // The `Toolpath` contract: the first move is a rapid to the first entry point.
      if (previous === null) throw new Error(`${step.name}: the toolpath starts with a feed`);
      const feed = limitFeed(previous, move.to, move.feedRate, input.machine);
      if (feed < move.feedRate) clamped++;
      out.feed({ x, y, z }, feed);
    }
    previous = move.to;
  }
  if (clamped > 0) {
    program.warnings.push({
      operation: step.name,
      message: { code: "grbl.slowed", values: { count: clamped } },
    });
  }
}

/** The machine's program end, else the spindle off, a rise, back to the XY zero and `M30`. */
function writeEnd(program: Program) {
  const { out, input } = program;
  const { machine, safeZ } = input;
  if (machine?.programEnd)
    out.custom("programEnd", fill(program, "programEnd", machine.programEnd));
  else {
    out.line("M5");
    out.rapid({ z: safeZ });
    out.rapidWork({ x: 0, y: 0 });
    out.line("M30");
  }
}

/** A custom block, then the modes the program's coordinates need. */
function writeCustom(program: Program, label: BlockLabel, block: string) {
  program.out.custom(label, fill(program, label, block));
  program.out.line(MODES);
}

/** `block` with its placeholders filled in, warning once about any left. */
function fill(program: Program, label: BlockLabel, block: string): string {
  const { stock, safeZ } = program.input;
  const filled = fillPlaceholders(block, stock, program.pad, safeZ);
  for (const placeholder of unfilledPlaceholders(filled)) {
    if (program.said.has(`${label} ${placeholder}`)) continue;
    program.said.add(`${label} ${placeholder}`);
    program.warnings.push({
      message: { code: "grbl.unfilledPlaceholder", values: { block: label, placeholder } },
    });
  }
  return filled;
}

/** Whether custom `block` stops the spindle (`M5`), or pauses or ends the program (`M0`, `M1`, `M2`, `M30`). */
function stopsSpindle(block: string): boolean {
  const code = block.replace(/\([^)]*\)/g, " ").replace(/;.*$/gm, " ");
  return /(?:^|[^A-Z])M0*(?:0|1|2|5|30)(?![0-9.])/i.test(code);
}
