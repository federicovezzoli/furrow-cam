import type { Model, ReliefFinishOperation } from "@furrow/document";
import type { Toolpath } from "../toolpath";
import { finishSetupSteps, parallelPassesSteps, type ReliefFinishOptions } from "./finish";
import { spiralSteps } from "./spiral";
import { waterlineSteps } from "./waterline";

/**
 * The toolpath of a 3D finishing operation (PRD-0005 S4, S10, ADR-0030), in
 * stock coordinates, with the operation's strategy: parallel passes
 * (`parallelPassesSteps`), waterline contours (`waterlineSteps`) or a spiral
 * (`spiralSteps`). Yields the fraction done as it goes, so a worker can
 * report progress and stop between steps. The grid is laid out along
 * parallel passes, and along the stock's axes for the others, so they share
 * cached heightmaps.
 */
export function* reliefFinishSteps(
  operation: ReliefFinishOperation,
  model: Model,
  positions: Float32Array,
  options: ReliefFinishOptions,
): Generator<number, Toolpath> {
  const { strategy } = operation.params;
  const angle = strategy.type === "parallel" ? strategy.angle : 0;
  const setup = yield* finishSetupSteps(operation, model, positions, angle, options);
  if ("code" in setup) return { moves: [], warnings: [setup] };
  switch (strategy.type) {
    case "parallel":
      return yield* parallelPassesSteps(operation, setup, strategy, options);
    case "waterline":
      return yield* waterlineSteps(operation, setup, strategy, options);
    case "spiral":
      return yield* spiralSteps(operation, setup, strategy, options);
  }
}
