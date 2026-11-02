import { useCallback, useEffect, useRef } from 'react'
import {
  isSetupStep,
  type OnboardingDraft,
  type OnboardingProfile,
  type OnboardingState,
  type SetupDraft,
  type SetupItem,
  type SetupRow
} from '@shared/ipc'
import { itemOf } from './setupApply'
import { emptySetupDraft } from './setupDraft'
import type { SetupView } from './setupSteps'
import { isListedCountry, LANGUAGE_OPTIONS } from './markets'
import { emptyProfileDraft } from './validate'

/**
 * Docs/FEEDBACK.md batch 2 row 4: an unfinished onboarding keeps its step and
 * typed fields across restarts. The renderer saves a debounced draft to main;
 * main drops it when onboarding finishes. Keys are never part of a draft.
 *
 * Onboarding v2 keeps everything in `setup` (the SetupDraft) and the step in
 * `setupView`; the v1 fields are sent empty so an older main still parses it.
 */

/** Long enough to batch typing, short enough that a quit rarely loses a keystroke. */
export const DRAFT_SAVE_DELAY_MS = 400

/** What autosave sends: the v2 setup, with the v1 fields at their empty defaults. */
export function toOnboardingDraft(view: SetupView, setup: SetupDraft): OnboardingDraft {
  return {
    view: view === 'welcome' ? 'welcome' : 'profile',
    profile: emptyProfileDraft(),
    fill: null,
    budget: '',
    setupView: view,
    setup
  }
}

const userRow = (name: string, url: string | null = null): SetupRow => ({
  name,
  detail: '',
  url,
  tag: null
})

function userItems(rows: readonly SetupRow[]): SetupItem[] {
  return rows.filter((row) => row.name.trim().length > 0).map((row) => itemOf(row, 'user'))
}

/** A v1 draft's profile form, mapped into the v2 site and lists as the user's own rows. */
function setupFromV1(profile: OnboardingDraft['profile']): SetupDraft {
  const empty = emptySetupDraft()
  return {
    ...empty,
    site: {
      domain: profile.domain,
      projectName: profile.projectName,
      userName: profile.userName,
      country: profile.country,
      countryCode: profile.countryCode,
      language: profile.language,
      languageCode: profile.languageCode,
      location: profile.location
    },
    lists: {
      ...empty.lists,
      brands: userItems(profile.brands.map((name) => userRow(name))),
      competitors: userItems(profile.competitors.map((host) => userRow(host, host))),
      switchingFrom: userItems(profile.switchingFrom.map((name) => userRow(name))),
      integrations: userItems(profile.integrations.map((name) => userRow(name)))
    }
  }
}

/** A saved profile (no draft kept), mapped into the v2 site and lists. */
function setupFromProfile(profile: OnboardingProfile): SetupDraft {
  const market = profile.defaultMarket
  const countryKnown = isListedCountry(market.country)
  const languageKnown = LANGUAGE_OPTIONS.some((option) => option.value === market.language)
  return setupFromV1({
    ...emptyProfileDraft(),
    userName: profile.userName,
    projectName: profile.project.name,
    domain: profile.project.domain,
    brands: [...profile.brandNames],
    competitors: [...profile.competitors],
    switchingFrom: [...(profile.switchingFrom ?? [])],
    integrations: [...(profile.integrations ?? [])],
    country: countryKnown ? market.country : 'other',
    countryCode: countryKnown ? '' : market.country,
    language: languageKnown ? market.language : 'other',
    languageCode: languageKnown ? '' : market.language,
    location: market.location ?? ''
  })
}

/** True when a v1 profile form holds anything typed. */
function typedV1(profile: OnboardingDraft['profile']): boolean {
  return (
    profile.domain.trim() !== '' ||
    profile.projectName.trim() !== '' ||
    profile.userName.trim() !== '' ||
    profile.brands.length > 0 ||
    profile.country !== '' ||
    profile.language !== ''
  )
}

/**
 * The setup a restart opens with: the v2 draft, else an old v1 draft mapped into the
 * site, else the saved profile, else empty.
 */
export function restoredSetup(draft: OnboardingDraft | null, state: OnboardingState): SetupDraft {
  if (draft?.setup) return draft.setup
  if (draft && typedV1(draft.profile)) return setupFromV1(draft.profile)
  if (state.profile) return setupFromProfile(state.profile)
  return emptySetupDraft()
}

/**
 * The page a restart opens on: the saved v2 step, else step 1 for an old v1 draft,
 * else the welcome screen. OnboardingApp still checks the step can be reached.
 */
export function restoredSetupView(draft: OnboardingDraft | null): SetupView {
  if (draft?.setupView === 'welcome') return 'welcome'
  if (draft?.setupView && isSetupStep(draft.setupView)) return draft.setupView
  if (draft && draft.view !== 'welcome') return 'site'
  return 'welcome'
}

/**
 * Saves `draft` after it stops changing for {@link DRAFT_SAVE_DELAY_MS}, and at
 * once when the window closes. `stop()` cancels any pending save for good (Finish).
 * A failed save is ignored: the draft is a convenience, never a blocker.
 */
export function useDraftAutosave(
  save: (draft: OnboardingDraft) => Promise<unknown>,
  draft: OnboardingDraft,
  delayMs = DRAFT_SAVE_DELAY_MS
): { stop: () => void } {
  const serialized = JSON.stringify(draft)
  const latest = useRef({ draft, serialized })
  const lastSaved = useRef(serialized)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)
  const saveRef = useRef(save)

  // Runs before the effects below, so a flush always sends the newest draft.
  useEffect(() => {
    latest.current = { draft, serialized }
    saveRef.current = save
  })

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (stopped.current || latest.current.serialized === lastSaved.current) return
    lastSaved.current = latest.current.serialized
    void saveRef.current(latest.current.draft).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (stopped.current || serialized === lastSaved.current) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delayMs)
  }, [serialized, delayMs, flush])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  const stop = useCallback(() => {
    stopped.current = true
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  return { stop }
}
