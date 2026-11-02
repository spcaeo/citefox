/** Buyer profiles, buyer prompts, gaps, and coverage runs. */

import type { coverageChannels, IpcHandlersFor, promptsChannels } from '@shared/ipc'
import {
  generateGaps,
  getCoverage,
  getGaps,
  listCoverage,
  redoGap,
  setGapDone
} from '../engine/gaps'
import {
  getGapStates,
  parseSetGapStatus,
  parseUpdateGapDraft,
  setGapStatus,
  updateGapDraft
} from '../engine/gap-states'
import { generateProfile, getProfile, updateProfile } from '../engine/profile'
import { addQuestions, questionTextRules } from '../engine/prompt-add'
import { googleQuestions, questionTargets } from '../engine/prompt-targets'
import { promptVersions, rewordPrompt } from '../engine/prompt-reword'
import {
  addPrompt,
  discardPrompts,
  editPrompt,
  generatePrompts,
  listPrompts,
  listPromptSets,
  removePrompt,
  reorderPrompts,
  savePrompts,
  setActivePromptSet,
  setEnabled
} from '../engine/prompts'
import {
  parseAddPrompt,
  parseAddQuestions,
  parseCoverageRun,
  parseEditPrompt,
  parseGenerateCoverage,
  parseGenerateProfile,
  parseGeneratePrompts,
  parsePageId,
  parseProjectId,
  parsePromptId,
  parseReorderPrompts,
  parseRewordPrompt,
  parseSetActivePromptSet,
  parseSetGapDone,
  parseSetPromptEnabled,
  parseUpdateBuyerProfile
} from '../ipc-m2'
import { guard, type EngineContext } from './context'

export function promptsHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof promptsChannels> & IpcHandlersFor<typeof coverageChannels> {
  return {
    'buyerProfile:get': (request) =>
      guard('buyerProfile:get', ctx, () => {
        const parsed = parsePageId(request, 'buyerProfile:get')
        return getProfile(ctx, parsed.projectId, parsed.pageId)
      }),
    'buyerProfile:generate': (request) =>
      guard('buyerProfile:generate', ctx, () => {
        const parsed = parseGenerateProfile(request)
        return generateProfile(
          ctx,
          parsed.projectId,
          parsed.pageId,
          parsed.templateId,
          parsed.fresh === true
        )
      }),
    'buyerProfile:update': (request) =>
      guard('buyerProfile:update', ctx, () => updateProfile(ctx, parseUpdateBuyerProfile(request))),
    'prompts:list': (request) =>
      guard('prompts:list', ctx, () => {
        const parsed = parsePageId(request, 'prompts:list')
        return listPrompts(ctx, parsed.projectId, parsed.pageId)
      }),
    'prompts:listSets': (request) =>
      guard('prompts:listSets', ctx, () => {
        const parsed = parsePageId(request, 'prompts:listSets')
        return listPromptSets(ctx, parsed.projectId, parsed.pageId)
      }),
    'prompts:setActive': (request) =>
      guard('prompts:setActive', ctx, () =>
        setActivePromptSet(ctx, parseSetActivePromptSet(request))
      ),
    'prompts:generate': (request) =>
      guard('prompts:generate', ctx, () => {
        const parsed = parseGeneratePrompts(request)
        return generatePrompts(ctx, parsed.projectId, parsed.pageId, parsed.templateId)
      }),
    'prompts:add': (request) =>
      guard('prompts:add', ctx, () => addPrompt(ctx, parseAddPrompt(request))),
    'prompts:edit': (request) =>
      guard('prompts:edit', ctx, () => editPrompt(ctx, parseEditPrompt(request))),
    'prompts:remove': (request) =>
      guard('prompts:remove', ctx, () => {
        const parsed = parsePromptId(request, 'prompts:remove')
        return removePrompt(ctx, parsed.projectId, parsed.pageId, parsed.promptId)
      }),
    'prompts:setEnabled': (request) =>
      guard('prompts:setEnabled', ctx, () => setEnabled(ctx, parseSetPromptEnabled(request))),
    'prompts:reorder': (request) =>
      guard('prompts:reorder', ctx, () => reorderPrompts(ctx, parseReorderPrompts(request))),
    'prompts:save': (request) =>
      guard('prompts:save', ctx, () => {
        const parsed = parsePageId(request, 'prompts:save')
        return savePrompts(ctx, parsed.projectId, parsed.pageId)
      }),
    'prompts:discard': (request) =>
      guard('prompts:discard', ctx, () => {
        const parsed = parsePageId(request, 'prompts:discard')
        return discardPrompts(ctx, parsed.projectId, parsed.pageId)
      }),
    'prompts:reword': (request) =>
      guard('prompts:reword', ctx, () => rewordPrompt(ctx, parseRewordPrompt(request))),
    'prompts:versions': (request) =>
      guard('prompts:versions', ctx, () =>
        promptVersions(ctx, parsePromptId(request, 'prompts:versions'))
      ),
    'prompts:addQuestions': (request) =>
      guard('prompts:addQuestions', ctx, () => addQuestions(ctx, parseAddQuestions(request))),
    'prompts:textRules': (request) =>
      guard('prompts:textRules', ctx, () =>
        questionTextRules(ctx, parsePageId(request, 'prompts:textRules'))
      ),
    'prompts:addTargets': (request) =>
      guard('prompts:addTargets', ctx, () =>
        questionTargets(ctx, parseProjectId(request, 'prompts:addTargets'))
      ),
    'prompts:googleQuestions': (request) =>
      guard('prompts:googleQuestions', ctx, () =>
        googleQuestions(ctx, parsePageId(request, 'prompts:googleQuestions'))
      ),
    'gaps:get': (request) =>
      guard('gaps:get', ctx, () => getGaps(ctx, parsePageId(request, 'gaps:get'))),
    'gaps:generate': (request) =>
      guard('gaps:generate', ctx, () => generateGaps(ctx, parseGenerateCoverage(request))),
    'gaps:setDone': (request) =>
      guard('gaps:setDone', ctx, () => setGapDone(ctx, parseSetGapDone(request))),
    'gaps:redo': (request) =>
      guard('gaps:redo', ctx, () => {
        const parsed = parsePromptId(request, 'gaps:redo')
        return redoGap(ctx, parsed)
      }),
    'gaps:getStates': (request) =>
      guard('gaps:getStates', ctx, () => getGapStates(ctx, parsePageId(request, 'gaps:getStates'))),
    'gaps:updateDraft': (request) =>
      guard('gaps:updateDraft', ctx, () => updateGapDraft(ctx, parseUpdateGapDraft(request))),
    'gaps:setStatus': (request) =>
      guard('gaps:setStatus', ctx, () => setGapStatus(ctx, parseSetGapStatus(request))),
    'coverage:list': (request) =>
      guard('coverage:list', ctx, () => listCoverage(ctx, parsePageId(request, 'coverage:list'))),
    'coverage:get': (request) =>
      guard('coverage:get', ctx, () => getCoverage(ctx, parseCoverageRun(request)))
  }
}
