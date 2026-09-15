import { Evaluator, type EvaluatorContext } from 'logfire/evals';
import type { NativeCaseMetadata, NativeOutput, NativeTaskInput } from './evaluation-types.ts';

/** The terminal native result is the minimum execution assertion for every case. */
export class ExecutionPass extends Evaluator<NativeTaskInput, NativeOutput, NativeCaseMetadata> {
  static override evaluatorName = 'execution_pass';

  override evaluate({ output }: EvaluatorContext<NativeTaskInput, NativeOutput, NativeCaseMetadata>): boolean {
    return output.lastResult?.status === 'completed'
      && output.operation === null
      && !output.faulted;
  }
}
