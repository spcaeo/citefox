import type { BuyerProfile } from '@shared/domain'
import { applyTemplateChoice } from '../templates'
import { ALERTS_PAGE_ID, alertsProfile } from '../textboltPage'
import type { SetupContext } from './context'
import { blankProfile, channelError, clone } from './helpers'
import type { SetupStore } from './types'

/** `buyerProfile:*` channels. */
export function createProfileMethods(
  ctx: SetupContext
): Pick<SetupStore, 'getProfile' | 'generateProfile' | 'updateProfile'> {
  const { memory, nextId, now, requirePage, stateFor } = ctx
  return {
    getProfile(request) {
      requirePage(request, 'buyerProfile:get')
      const profile = stateFor(request.pageId).profile
      return profile ? clone(profile) : null
    },

    async generateProfile(request) {
      const state = requirePage(request, 'buyerProfile:generate')
      if (!state.read || state.read.nextStep !== null) {
        throw channelError(
          'buyerProfile:generate',
          'Read the page before building a buyer profile.'
        )
      }
      const page = memory.getPage(request.projectId, request.pageId)
      const base =
        request.pageId === ALERTS_PAGE_ID ? alertsProfile() : blankProfile(request.pageId)
      const chosen = await applyTemplateChoice(
        'buyer_profile',
        request.templateId,
        'buyerProfile:generate',
        request.projectId,
        request.pageId,
        'buyerProfiles'
      )
      const snapshotId = state.read.id
      if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
        throw channelError(
          'buyerProfile:generate',
          'Read the page before building a buyer profile.'
        )
      }
      const profile: BuyerProfile = {
        ...base,
        id: nextId('icp'),
        pageId: request.pageId,
        snapshotId,
        ...chosen,
        createdAt: now(),
        promptsStale: state.prompts.version !== null
      }
      state.profile = profile
      memory.noteSetup(request.projectId, request.pageId, {
        setupStep: page.setupStep === 'profile' ? 'prompts' : page.setupStep
      })
      return clone(profile)
    },

    updateProfile(request) {
      const state = requirePage(request, 'buyerProfile:update')
      if (!state.profile) {
        throw channelError('buyerProfile:update', 'Generate a buyer profile before editing it.')
      }
      state.profile = {
        ...state.profile,
        who: request.who ?? state.profile.who,
        environment: request.environment ?? state.profile.environment,
        segments: request.segments ? clone(request.segments) : state.profile.segments,
        triggers: request.triggers ? [...request.triggers] : state.profile.triggers,
        values: request.values ? [...request.values] : state.profile.values,
        poorFit: request.poorFit ? clone(request.poorFit) : state.profile.poorFit,
        promptsStale: state.prompts.version !== null
      }
      return clone(state.profile)
    }
  }
}
