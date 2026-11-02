/** Brand sentiment: brand prompts, brand facts, claims, and re-reads (SRS 4.16). */

import type { IpcHandlersFor, sentimentChannels } from '@shared/ipc'
import { resolveClaude } from '../engine/claude'
import {
  parseAddFact,
  parseDeleteFact,
  parseFactsRequest,
  parsePageRequest,
  parseSaveBrandPrompts,
  parseSentimentRequest
} from '../engine/sentiment/parse'
import { createSentimentService, type SentimentService } from '../engine/sentiment/service'
import { emitMainEvent } from '../ipc-events'
import { guard, runCheckChannel, type EngineContext } from './context'

export function sentimentHandlers(
  ctx: EngineContext,
  service: SentimentService = createSentimentService({
    storage: ctx.storage,
    logger: ctx.logger,
    now: ctx.now,
    createId: ctx.createId,
    knownSecrets: ctx.knownSecrets,
    claude: (projectId) => resolveClaude(ctx, 'sentiment', projectId),
    emitUpdated: (event) => {
      emitMainEvent('sentiment:updated', event)
    }
  })
): IpcHandlersFor<typeof sentimentChannels> {
  const run = <T>(channel: string, work: () => Promise<T> | T): Promise<T> =>
    guard(channel, ctx, () => runCheckChannel(channel, work))
  return {
    'sentiment:get': (request) =>
      run('sentiment:get', () => service.get(parseSentimentRequest(request))),
    'sentiment:generateBrandPrompts': (request) =>
      run('sentiment:generateBrandPrompts', () =>
        service.generateBrandPrompts(parsePageRequest(request, 'sentiment:generateBrandPrompts'))
      ),
    'sentiment:saveBrandPrompts': (request) =>
      run('sentiment:saveBrandPrompts', () =>
        service.saveBrandPrompts(parseSaveBrandPrompts(request))
      ),
    'sentiment:listFacts': (request) =>
      run('sentiment:listFacts', () => service.listFacts(parseFactsRequest(request).projectId)),
    'sentiment:addFact': (request) =>
      run('sentiment:addFact', () => service.addFact(parseAddFact(request))),
    'sentiment:deleteFact': (request) =>
      run('sentiment:deleteFact', () => service.deleteFact(parseDeleteFact(request))),
    'sentiment:reread': (request) =>
      run('sentiment:reread', () => service.reread(parsePageRequest(request, 'sentiment:reread')))
  }
}
