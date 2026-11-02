import { existsSync, readFileSync, rmSync } from 'node:fs'
import type {
  FillFromWebsiteResult,
  OnboardingDraft,
  OnboardingDraftView,
  OnboardingProfileDraft
} from '@shared/ipc'
import { isOnboardingStep } from '@shared/ipc'
import { atomicWriteFile } from './atomic-file'
import { parseSetupDraft, parseSetupView, SetupDraftError } from './setup-draft'

/**
 * An unfinished onboarding (Docs/FEEDBACK.md batch 2 row 4): the step, the profile
 * form as typed, and the last "Fill from my website" read. It lives in
 * `onboarding-draft.json` in the data folder, so a reset moves it aside with the
 * rest, and it is removed when onboarding finishes. It never holds a secret: keys
 * are saved by their own steps and are not part of the draft.
 */

/**
 * Big enough for a fill read with long reasons plus the v2 setup (eight lists of up to
 * 100 rows and the edited prompts); small enough to refuse junk.
 */
export const MAX_DRAFT_BYTES = 1024 * 1024
const MAX_TEXT = 500
const MAX_LIST = 50

const PROFILE_TEXT_FIELDS = [
  'userName',
  'projectName',
  'domain',
  'brandDraft',
  'competitorDraft',
  'country',
  'countryCode',
  'language',
  'languageCode',
  'location'
] as const
const PROFILE_LIST_FIELDS = ['brands', 'competitors', 'switchingFrom', 'integrations'] as const
const FILL_LIST_FIELDS = [
  'pagesRead',
  'brands',
  'competitors',
  'switchingFrom',
  'integrations'
] as const

export class OnboardingDraftError extends Error {
  constructor() {
    super('Invalid onboarding draft')
    this.name = 'OnboardingDraftError'
  }
}

/** Checks a draft from the renderer or the file. Throws {@link OnboardingDraftError}. */
export function parseOnboardingDraft(value: unknown): OnboardingDraft {
  const record = plain(value)
  // `setupView` and `setup` are onboarding v2's; a draft saved before v2 has neither.
  const v2 = ['setupView', 'setup'].filter((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  )
  onlyKeys(record, ['view', 'profile', 'fill', 'budget', ...v2])
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify(record), 'utf8')
  } catch {
    throw new OnboardingDraftError()
  }
  if (size > MAX_DRAFT_BYTES) throw new OnboardingDraftError()
  const draft: OnboardingDraft = {
    view: readView(record.view),
    profile: readProfile(record.profile),
    fill: readFill(record.fill),
    budget: readText(record.budget)
  }
  try {
    if (v2.includes('setupView')) draft.setupView = parseSetupView(record.setupView)
    if (v2.includes('setup')) draft.setup = parseSetupDraft(record.setup)
  } catch (error) {
    if (error instanceof SetupDraftError) throw new OnboardingDraftError()
    throw error
  }
  return draft
}

/** The saved draft, or null when there is none or the file cannot be read. */
export function readOnboardingDraft(file: string): OnboardingDraft | null {
  if (!existsSync(file)) return null
  try {
    return parseOnboardingDraft(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // A broken draft is not worth an error: onboarding starts from its saved state.
    return null
  }
}

export function writeOnboardingDraft(file: string, draft: OnboardingDraft): void {
  atomicWriteFile(file, `${JSON.stringify(parseOnboardingDraft(draft))}\n`)
}

export function clearOnboardingDraft(file: string): void {
  rmSync(file, { force: true })
}

function readView(value: unknown): OnboardingDraftView {
  if (value === 'welcome') return value
  if (typeof value === 'string' && isOnboardingStep(value)) return value
  throw new OnboardingDraftError()
}

function readProfile(value: unknown): OnboardingProfileDraft {
  const record = plain(value)
  onlyKeys(record, [...PROFILE_TEXT_FIELDS, ...PROFILE_LIST_FIELDS])
  return {
    userName: readText(record.userName),
    projectName: readText(record.projectName),
    domain: readText(record.domain),
    brands: readList(record.brands),
    brandDraft: readText(record.brandDraft),
    competitors: readList(record.competitors),
    competitorDraft: readText(record.competitorDraft),
    switchingFrom: readList(record.switchingFrom),
    integrations: readList(record.integrations),
    country: readText(record.country),
    countryCode: readText(record.countryCode),
    language: readText(record.language),
    languageCode: readText(record.languageCode),
    location: readText(record.location)
  }
}

/**
 * The fill result is the engine's own output, shown again as it was. Main never
 * acts on it, so only its outline is checked here; the size cap bounds the rest.
 */
function readFill(value: unknown): FillFromWebsiteResult | null {
  if (value === null) return null
  const record = plain(value)
  if (typeof record.domain !== 'string' || typeof record.message !== 'string') {
    throw new OnboardingDraftError()
  }
  for (const key of FILL_LIST_FIELDS) {
    if (!Array.isArray(record[key])) throw new OnboardingDraftError()
  }
  if (record.nextStep !== null && typeof record.nextStep !== 'string') {
    throw new OnboardingDraftError()
  }
  if (record.suggestedMarket !== null && !isPlain(record.suggestedMarket)) {
    throw new OnboardingDraftError()
  }
  return record as unknown as FillFromWebsiteResult
}

function readText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new OnboardingDraftError()
  return value
}

function readList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST) throw new OnboardingDraftError()
  return value.map(readText)
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function plain(value: unknown): Record<string, unknown> {
  if (!isPlain(value)) throw new OnboardingDraftError()
  return value
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new OnboardingDraftError()
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new OnboardingDraftError()
  }
}
