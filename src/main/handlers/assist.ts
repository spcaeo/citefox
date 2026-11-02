/** AI assists, the Claude call log, Ask CiteFox and its context-aware assistant. */

import type {
  askChannels,
  assistantChannels,
  assistChannels,
  IpcHandlersFor,
  llmChannels
} from '@shared/ipc'
import { ensureShippedAssists } from '../assist/definitions'
import { describeAssist, runAssist } from '../assist/run'
import { askOptions, askQuestion, filterAnswer } from '../ask/answer'
import { askAssistant } from '../assistant/answer'
import { parseAssistantAsk } from '../ipc-assistant'
import {
  parseAskFilter,
  parseAskProject,
  parseAskQuestion,
  parseAssistDescribe,
  parseAssistRun,
  parseLlmCalls,
  parseLlmUsage
} from '../ipc-ai'
import { readLlmCalls } from '../llm/calls'
import { readLlmUsage } from '../llm/usage'
import { guard, type EngineContext } from './context'

export function assistHandlers(
  ctx: EngineContext
): IpcHandlersFor<
  typeof assistChannels & typeof llmChannels & typeof askChannels & typeof assistantChannels
> {
  ensureShippedAssists()
  return {
    'assist:describe': (request) =>
      guard('assist:describe', ctx, () => describeAssist(ctx, parseAssistDescribe(request))),
    'assist:run': (request) =>
      guard('assist:run', ctx, () => runAssist(ctx, parseAssistRun(request))),
    'llm:usage': (request) =>
      guard('llm:usage', ctx, () => {
        const parsed = parseLlmUsage(request)
        return readLlmUsage(ctx.storage, {
          ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
          now: ctx.now()
        })
      }),
    'llm:calls': (request) =>
      guard('llm:calls', ctx, () => readLlmCalls(ctx.storage, parseLlmCalls(request))),
    'ask:question': (request) =>
      guard('ask:question', ctx, () => askQuestion(ctx, parseAskQuestion(request))),
    'ask:filter': (request) =>
      guard('ask:filter', ctx, () => filterAnswer(ctx, parseAskFilter(request))),
    'ask:options': (request) =>
      guard('ask:options', ctx, () => askOptions(ctx, parseAskProject(request))),
    'assistant:ask': (request) =>
      guard('assistant:ask', ctx, () => askAssistant(ctx, parseAssistantAsk(request)))
  }
}
