/** "✦ Help me fill this": the prompt for the user's chatbot, reading its answer, Describe. */

import type { helpFillChannels, IpcHandlersFor } from '@shared/ipc'
import {
  parseHelpFillDescribe,
  parseHelpFillEstimate,
  parseHelpFillPrompt,
  parseHelpFillRead
} from '../helpfill/parse'
import {
  describeHelpFill,
  estimateHelpFill,
  promptHelpFill,
  readHelpFill
} from '../helpfill/service'
import {
  estimateSetup,
  parseSetupPrompt,
  parseSetupRead,
  promptSetup,
  readSetup
} from '../helpfill/setup'
import { guard, type EngineContext } from './context'

export function helpFillHandlers(ctx: EngineContext): IpcHandlersFor<typeof helpFillChannels> {
  return {
    'helpfill:estimate': (request) =>
      guard('helpfill:estimate', ctx, () => estimateHelpFill(ctx, parseHelpFillEstimate(request))),
    'helpfill:prompt': (request) =>
      guard('helpfill:prompt', ctx, () => promptHelpFill(ctx, parseHelpFillPrompt(request))),
    'helpfill:read': (request) =>
      guard('helpfill:read', ctx, () => readHelpFill(ctx, parseHelpFillRead(request))),
    'helpfill:describe': (request) =>
      guard('helpfill:describe', ctx, () => describeHelpFill(ctx, parseHelpFillDescribe(request))),
    'helpfill:setupEstimate': () => guard('helpfill:setupEstimate', ctx, () => estimateSetup(ctx)),
    'helpfill:setupPrompt': (request) =>
      guard('helpfill:setupPrompt', ctx, () => promptSetup(ctx, parseSetupPrompt(request))),
    'helpfill:setupRead': (request) =>
      guard('helpfill:setupRead', ctx, () => readSetup(parseSetupRead(request)))
  }
}
