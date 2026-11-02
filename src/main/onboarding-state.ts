import type { ProjectSummary } from '@shared/domain'
import type { OnboardingProfile, OnboardingState, OnboardingStepState } from '@shared/ipc'
import type { ProjectProfile } from './storage/project-profile'

export function buildOnboardingState(input: {
  finished: boolean
  userName: string | null
  project: ProjectSummary | null
  profile: ProjectProfile | null
  hasSerpApiKey: boolean
  hasAnthropicKey: boolean
  hasJinaKey: boolean
  hasCheckup: boolean
}): OnboardingState {
  // "Your name" is optional (onboarding v2): the site and the project make the profile.
  const profileReady = input.project !== null && input.profile !== null
  const profileStatus = profileReady ? 'done' : 'pending'
  const serpapiStatus = input.hasSerpApiKey ? 'done' : 'pending'
  const claudeStatus = input.hasCheckup || input.hasAnthropicKey ? 'done' : 'pending'
  let jinaStatus: OnboardingStepState['status'] = input.hasJinaKey ? 'done' : 'pending'
  if (input.finished && jinaStatus === 'pending') jinaStatus = 'skipped'
  const steps: OnboardingStepState[] = [
    { id: 'profile', status: profileStatus },
    { id: 'serpapi', status: serpapiStatus },
    { id: 'claude', status: claudeStatus },
    { id: 'jina', status: jinaStatus }
  ]
  const pending = steps.find((step) => step.status === 'pending')
  const saved: OnboardingProfile | null =
    profileReady && input.project !== null && input.profile !== null
      ? {
          userName: input.userName ?? '',
          project: input.project,
          includeSubdomains: input.profile.includeSubdomains,
          brandNames: input.profile.brandNames,
          competitors: input.profile.competitors,
          defaultMarket: input.profile.market,
          switchingFrom: input.profile.switchingFrom ?? [],
          integrations: input.profile.integrations ?? []
        }
      : null
  return {
    finished: input.finished,
    currentStep: input.finished ? null : (pending?.id ?? null),
    profile: saved,
    steps
  }
}
