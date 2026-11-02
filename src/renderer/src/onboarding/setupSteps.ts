import { isCountryCode, isLanguageTag } from '@shared/domain'
import {
  isSetupStep,
  SETUP_STEPS,
  type SetupDraft,
  type SetupSiteDraft,
  type SetupStep
} from '@shared/ipc'
import {
  isRegistrableDomain,
  normalizeCountry,
  normalizeDomain,
  normalizeLanguageTag,
  PROFILE_COPY
} from './validate'

/**
 * Onboarding v2's nine steps (Docs/onboarding-v2.mockup.html, plus step 8 "How do your
 * buyers ask AI?", owner feedback 2026-10-25): their stepper labels,
 * their URLs (`#/setup/<step>`) and what each needs before the next one opens.
 */

/** The page on screen: the welcome screen or one step. */
export type SetupView = 'welcome' | SetupStep

export const SETUP_STEP_LABELS: Readonly<Record<SetupStep, string>> = {
  site: 'Site',
  claude: 'AI',
  read: 'Read',
  brand: 'Brand',
  buyers: 'Buyers',
  competitors: 'Rivals',
  engines: 'Engines',
  shapes: 'Ask',
  questions: 'Questions'
}

/** What the footer says Continue leads to ("Next: connect your AI"). */
export const SETUP_NEXT_NOTE: Readonly<Record<SetupStep, string>> = {
  site: 'Next: connect your AI',
  claude: 'Next: read your site',
  read: 'Next: your brand and products',
  brand: 'Next: your buyers',
  buyers: 'Next: competitors',
  competitors: 'Next: AI answers to track',
  engines: 'Next: how buyers ask AI',
  shapes: 'Next: your first prompts',
  questions: ''
}

export function stepNumber(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step) + 1
}

/** "STEP 3 OF 9". */
export function stepKicker(step: SetupStep): string {
  return `Step ${stepNumber(step)} of ${SETUP_STEPS.length}`
}

export function stepHash(view: SetupView): string {
  return view === 'welcome' ? '#/welcome' : `#/setup/${view}`
}

/** The view a hash names (`#/setup/read?open=…` is `read`), or null for any other hash. */
export function parseSetupHash(hash: string): SetupView | null {
  const path = hash.replace(/^#/, '').split('?')[0] ?? ''
  if (path === '/welcome') return 'welcome'
  const match = /^\/setup\/([a-z]+)\/?$/.exec(path)
  const step = match?.[1]
  return step !== undefined && isSetupStep(step) ? step : null
}

export function previousStep(step: SetupStep): SetupView {
  const index = SETUP_STEPS.indexOf(step)
  return index <= 0 ? 'welcome' : (SETUP_STEPS[index - 1] ?? 'welcome')
}

export function nextStep(step: SetupStep): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? null
}

export interface SiteErrors {
  domain?: string
  country?: string
  language?: string
}

/** Step 1's checks: website, country and language are required; the name is optional. */
export function siteErrors(site: SetupSiteDraft): SiteErrors {
  const errors: SiteErrors = {}
  const domain = normalizeDomain(site.domain)
  if (!site.domain.trim()) errors.domain = PROFILE_COPY.domainMissing
  else if (!isRegistrableDomain(domain)) errors.domain = PROFILE_COPY.domainInvalid
  const country = site.country === 'other' ? site.countryCode : site.country
  if (!country.trim()) errors.country = PROFILE_COPY.country
  else if (!isCountryCode(normalizeCountry(country))) errors.country = PROFILE_COPY.countryInvalid
  const language = site.language === 'other' ? site.languageCode : site.language
  if (!language.trim()) errors.language = PROFILE_COPY.language
  else if (!isLanguageTag(normalizeLanguageTag(language))) {
    errors.language = PROFILE_COPY.languageInvalid
  }
  return errors
}

export function siteValid(site: SetupSiteDraft): boolean {
  const errors = siteErrors(site)
  return !errors.domain && !errors.country && !errors.language
}

/** What the draft cannot tell: saved on the computer by Continue on steps 6 and 7. */
export interface SetupProgress {
  /** `onboarding:saveProfile` ran (leaving step 6): the project exists. */
  profileSaved: boolean
  /** A cloro or SerpApi key is saved and works (step 7). */
  searchReady: boolean
}

export function keptCount(draft: SetupDraft, list: keyof SetupDraft['lists']): number {
  return draft.lists[list].filter((item) => item.kept).length
}

/** True when `step` has what it needs, so the steps after it can open. */
export function stepComplete(step: SetupStep, draft: SetupDraft, progress: SetupProgress): boolean {
  switch (step) {
    case 'site':
      return siteValid(draft.site)
    case 'claude':
      // Claude is optional: "Skip and use your own ChatGPT" passes the step too.
      return true
    case 'read':
      return draft.readDone
    case 'brand':
      return draft.summary.trim().length > 0 && keptCount(draft, 'brands') > 0
    case 'buyers':
      return keptCount(draft, 'buyers') > 0
    case 'competitors':
      return progress.profileSaved
    case 'engines':
      return progress.searchReady
    case 'shapes':
      // Passed once its Continue ran (the prompts were written to a mix) or prompts exist.
      return draft.questionsMix !== null || draft.lists.questions.length > 0
    case 'questions':
      return false
  }
}

/** The first step that still needs something (the last step when all earlier ones are done). */
export function furthestStep(draft: SetupDraft, progress: SetupProgress): SetupStep {
  return SETUP_STEPS.find((step) => !stepComplete(step, draft, progress)) ?? 'questions'
}

/** A step opens once every step before it is complete. */
export function canReach(step: SetupStep, draft: SetupDraft, progress: SetupProgress): boolean {
  const index = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS.slice(0, index).every((before) => stepComplete(before, draft, progress))
}
