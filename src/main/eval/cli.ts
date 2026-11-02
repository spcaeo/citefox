// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import { EVAL_USAGE, EvalArgsError, parseEvalArgs, wantsEvalHelp } from './args'
import { runPromptEval } from './run'

/** Process entry: 0 when every site ran, 2 when a Claude limit stopped the run, 1 on error. */
export async function runPromptEvalCli(argv: readonly string[]): Promise<number> {
  if (wantsEvalHelp(argv)) {
    console.log(EVAL_USAGE)
    return 0
  }
  try {
    const args = parseEvalArgs(argv, process.cwd())
    const result = await runPromptEval(args, { log: (line) => console.log(line) })
    console.log(`Results: ${result.dir}`)
    return result.stopped === null ? 0 : 2
  } catch (error) {
    if (error instanceof EvalArgsError) {
      console.error(`${error.message}\n\n${EVAL_USAGE}`)
      return 1
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
