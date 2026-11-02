import { runAssistSmoke } from './assist'
import { runClassifySmoke } from './classify'
import { runGapsSmoke } from './gaps'
import type { PageSmokeHookContext, SmokeHookResult, TopicSmokeHookContext } from './hook-context'
import type { SmokeIo } from './live'
import { runReportsSmoke, runSentimentSmoke } from './sentiment'
import { runTopicInsightsSmoke } from './topic-insights'
import { runTopicKeywordsSmoke } from './topic-keywords'

export type { PageSmokeHookContext, SmokeHookResult, TopicSmokeHookContext }

/**
 * Live smoke hooks for the prompt-audit packages (Docs/PROMPT-AUDIT.md, P0 item 9).
 * Each package fills its own hook file; this file only says when each runs.
 *
 * Page smoke (`--gaps`, `--reports`, `--sentiment`, `--assist <id>`): after the
 * page read, profile, prompts, search, classify and score, in that order. Topic
 * smoke: `topic-keywords` (with `--competitor <url>` when given) and
 * `topic-insights` at the end of every run.
 *
 * A hook that is not written yet returns `notWrittenYet` (hook-context.ts). A flag the user
 * asked for then prints one "skipped" line; the topic hooks stay silent, so the
 * topic smoke prints what it printed before.
 */

/** Runs the page hooks the flags ask for. */
export async function runPageHooks(context: PageSmokeHookContext): Promise<void> {
  const { args } = context
  if (args.reports) announce(context, 'reports', await runReportsSmoke(context))
  if (args.gaps) announce(context, 'gaps', await runGapsSmoke(context))
  if (args.sentiment) announce(context, 'sentiment', await runSentimentSmoke(context))
  if (args.classify) announce(context, 'classify', await runClassifySmoke(context))
  if (args.assist !== null) {
    announce(context, `assist ${args.assist}`, await runAssistSmoke(context, args.assist))
  }
}

/** Runs the topic hooks at the end of the topic smoke. */
export async function runTopicHooks(context: TopicSmokeHookContext): Promise<void> {
  const keywords = await runTopicKeywordsSmoke(context, context.args.competitor)
  // Only a requested competitor page is worth a "skipped" line; the rest stays quiet.
  if (context.args.competitor !== null) announce(context, 'competitor', keywords)
  await runTopicInsightsSmoke(context)
}

function announce(context: { io: SmokeIo }, name: string, result: SmokeHookResult): void {
  if (!result.ran) context.io.stdout(`${name} skipped: ${result.detail}`)
}
