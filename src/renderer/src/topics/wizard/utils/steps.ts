import type { TopicDraft, TopicWizardStep } from '@shared/domain'
import { PATH_STEPS } from '../constants'
import type { WizardStepDef } from '../types'

type PathDraft = Pick<TopicDraft, 'path' | 'generate'>

/**
 * The steps of a draft's path. The seed path skips Keywords when it generates
 * buyer questions only, and Buyer profile and Questions when it generates
 * keywords only (spec §3).
 */
export function stepsFor(draft: PathDraft): readonly WizardStepDef[] {
  const steps = PATH_STEPS[draft.path]
  if (draft.path !== 'seed') return steps
  return steps.filter((step) => {
    if (step.id === 'keywords') return draft.generate !== 'questions'
    if (step.id === 'profile' || step.id === 'questions') return draft.generate !== 'keywords'
    return true
  })
}

/** The step to show: the saved one if it is on the path, else the first. */
export function currentStep(draft: PathDraft & Pick<TopicDraft, 'step'>): TopicWizardStep {
  const steps = stepsFor(draft)
  return steps.some((step) => step.id === draft.step) ? draft.step : (steps[0]?.id ?? 'seed')
}

export function nextStep(draft: PathDraft, step: TopicWizardStep): TopicWizardStep | null {
  const steps = stepsFor(draft)
  const index = steps.findIndex((item) => item.id === step)
  return index >= 0 ? (steps[index + 1]?.id ?? null) : null
}

export function previousStep(draft: PathDraft, step: TopicWizardStep): TopicWizardStep | null {
  const steps = stepsFor(draft)
  const index = steps.findIndex((item) => item.id === step)
  return index > 0 ? (steps[index - 1]?.id ?? null) : null
}

/** True when `target` comes before `step` on the path (a done step the stepper can open). */
export function isBefore(
  draft: PathDraft,
  target: TopicWizardStep,
  step: TopicWizardStep
): boolean {
  const steps = stepsFor(draft)
  const a = steps.findIndex((item) => item.id === target)
  const b = steps.findIndex((item) => item.id === step)
  return a >= 0 && b >= 0 && a < b
}
