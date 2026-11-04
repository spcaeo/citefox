import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX
} from 'react'
import { isIntervalDays, type ApiKeyMetadata } from '@shared/domain'
import type {
  EngineOption,
  FillFromWebsiteResult,
  OnboardingDraft,
  OnboardingState,
  SetupDraft,
  SetupStep
} from '@shared/ipc'
import { navigateHash, projectHash, replaceHash, topicHash } from '../shell/routes'
import { usePermissions } from '../ui'
import { normalizeCountry, normalizeDomain, normalizeLanguageTag } from './validate'
import type { OnboardingClient } from './client'
import { safeClientMessage } from './copy'
import {
  DRAFT_SAVE_FAILED_NOTICE,
  restoredSetup,
  restoredSetupView,
  toOnboardingDraft,
  useDraftAutosave
} from './draft'
import { createIpcSectionClient, type SetupSectionClient } from './sectionClient'
import { finishRequest, profileRequest } from './setupApply'
import { createIpcSetupServices, type SetupServices } from './setupServices'
import { SetupChrome } from './SetupChrome'
import {
  canReach,
  furthestStep,
  keptCount,
  nextStep,
  parseSetupHash,
  previousStep,
  stepHash,
  type SetupProgress,
  type SetupView
} from './setupSteps'
import { BrandStep } from './steps/BrandStep'
import { BuyersStep } from './steps/BuyersStep'
import { ClaudeStep } from './steps/ClaudeStep'
import { CompetitorsStep } from './steps/CompetitorsStep'
import {
  checkCost,
  effectiveEngines,
  firstCheckLine,
  planFor,
  searchBalance
} from './steps/engineCost'
import { EnginesStep } from './steps/EnginesStep'
import { QuestionsStep } from './steps/QuestionsStep'
import { ReadStep } from './steps/ReadStep'
import { ShapesStep } from './steps/ShapesStep'
import { SiteStep } from './steps/SiteStep'
import type { SetupStepProps } from './steps/types'
import { fallbackOptions } from './steps/useEngineChoices'
import { usePromptWriter } from './steps/usePromptWriter'
import { useShapeExamples } from './steps/useShapeExamples'
import { useSiteRead } from './steps/useSiteRead'
import { WelcomeScreen } from './WelcomeScreen'

function subscribeHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function hashView(): SetupView | null {
  return parseSetupHash(window.location.hash)
}

function searchKeyWorks(keys: readonly ApiKeyMetadata[]): boolean {
  return keys.some(
    (key) =>
      (key.provider === 'cloro' || key.provider === 'serpapi') && key.on && key.state === 'ok'
  )
}

/**
 * Onboarding v2 (Docs/onboarding-v2.mockup.html): nine short steps driven by the
 * SetupDraft, which autosaves with the step on screen. Every step has its URL
 * (`#/setup/<step>`; Back and Forward work) and opens only once the steps before it
 * have what they need. Continue's own work lives here: leaving step 6 saves the
 * profile, step 7 saves the engines and the schedule, step 8 writes the prompts to the
 * chosen mix, step 9 finishes setup and runs the first check.
 */
export function OnboardingApp({
  client,
  initialState,
  initialDraft = null,
  onFinished,
  sections: givenSections,
  services: givenServices,
  openLink
}: {
  client: OnboardingClient
  initialState: OnboardingState
  /** The unfinished onboarding saved before a restart (v2, or a v1 draft mapped into step 1). */
  initialDraft?: OnboardingDraft | null
  /** `landing`: the first topic setup made, so the app opens on it (and its first check). */
  onFinished: (landing: string | null) => void
  /** The section cards' channels. Production: the preload bridge. */
  sections?: SetupSectionClient
  /** Step 3's ChatGPT way and step 7's engines. Production: the preload bridge. */
  services?: SetupServices
  /** Test seam for links that open in the browser. */
  openLink?: (url: string) => void
}): JSX.Element {
  const sections = useMemo(() => givenSections ?? createIpcSectionClient(), [givenSections])
  const services = useMemo(() => givenServices ?? createIpcSetupServices(), [givenServices])
  const [state, setState] = useState(initialState)
  const [setup, setSetup] = useState<SetupDraft>(() => restoredSetup(initialDraft, initialState))
  const [keys, setKeys] = useState<readonly ApiKeyMetadata[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepAlert, setStepAlert] = useState<{ step: SetupStep; text: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [announcementLog, setAnnouncementLog] = useState<readonly string[]>([])
  const [engineOptions, setEngineOptions] = useState<readonly EngineOption[]>(fallbackOptions)
  const [claude, setClaude] = useState<{ available: boolean | null; reason: string | null }>({
    available: null,
    reason: null
  })
  const permissions = usePermissions()
  const routed = useSyncExternalStore(subscribeHash, hashView, () => null)
  const view: SetupView = routed ?? restoredSetupView(initialDraft)
  const progress: SetupProgress = useMemo(
    () => ({ profileSaved: state.profile !== null, searchReady: searchKeyWorks(keys) }),
    [state.profile, keys]
  )

  // Each step opens at its top, not at the scroll position of the step before.
  useLayoutEffect(() => {
    const page = document.scrollingElement
    if (page) page.scrollTop = 0
  }, [view])

  const draftRef = useRef(setup)
  const viewRef = useRef(view)
  useEffect(() => {
    draftRef.current = setup
    viewRef.current = view
  })

  const autosave = useDraftAutosave(
    (next) => client.saveDraft(next),
    toOnboardingDraft(view, setup)
  )
  const announce = useCallback((message: string) => {
    setAnnouncement(message)
    setAnnouncementLog((current) => [...current, message])
  }, [])
  const onDraft = useCallback((update: (current: SetupDraft) => SetupDraft) => {
    setSetup(update)
  }, [])

  const go = useCallback((next: SetupView) => {
    setStepAlert(null)
    navigateHash(stepHash(next))
  }, [])

  const read = useSiteRead({
    client,
    sections,
    draftRef,
    onDraft,
    onDone: useCallback(() => {
      if (viewRef.current === 'read') navigateHash(stepHash('brand'))
    }, [])
  })

  // Step 8's examples are written as soon as the site read is done; its prompts are
  // written while step 8 is open, so step 9 opens ready.
  const examples = useShapeExamples({ sections, draft: setup, draftRef, onDraft })
  const writer = usePromptWriter({ sections, draftRef, onDraft, announce })
  const { write } = writer
  useEffect(() => {
    const draft = draftRef.current
    if (draft.lists.questions.length > 0) return
    if (view === 'shapes') write(draft.mix)
    else if (view === 'questions') write(draft.questionsMix ?? draft.mix)
  }, [view, write])

  const refreshClaude = useCallback(() => {
    services['helpfill:setupEstimate']().then(
      (estimate) => setClaude({ available: estimate.available, reason: estimate.reason }),
      () => setClaude({ available: true, reason: null })
    )
  }, [services])

  useEffect(() => {
    let cancelled = false
    client.getOverview().then(
      (overview) => {
        if (cancelled) return
        setKeys(overview.keys)
        setLoaded(true)
      },
      (error: unknown) => {
        if (cancelled) return
        setLoaded(true)
        announce(safeClientMessage(error))
      }
    )
    refreshClaude()
    return () => {
      cancelled = true
    }
  }, [announce, client, refreshClaude])

  // Every page has its URL: a missing hash becomes the restored step, and a step whose
  // earlier steps are not done yet becomes the first step that still needs something.
  useEffect(() => {
    if (routed === null) {
      replaceHash(stepHash(view))
      return
    }
    if (routed === 'welcome' || !loaded) return
    if (!canReach(routed, setup, progress)) replaceHash(stepHash(furthestStep(setup, progress)))
  }, [routed, view, loaded, setup, progress])

  function remember(key: ApiKeyMetadata): void {
    setKeys((current) => [...current.filter((item) => item.id !== key.id), key])
  }

  async function saveAnthropic(
    secret: string
  ): Promise<{ error: string | null; hint: string | null }> {
    try {
      const existing = keys.find((key) => key.provider === 'anthropic') ?? null
      const meta = existing
        ? await client.replaceKey({ id: existing.id, secret })
        : await client.addKey({
            provider: 'anthropic',
            name: 'Anthropic',
            secret,
            cap: null,
            projectIds: []
          })
      const tested = await client.testKey({ id: meta.id })
      remember(tested.key)
      refreshClaude()
      if (tested.key.state !== 'ok') return { error: tested.message, hint: tested.key.hint }
      return { error: null, hint: tested.key.hint }
    } catch (error) {
      return { error: safeClientMessage(error, secret), hint: null }
    }
  }

  /** Runs Continue's own work for `step`; a failure stays on the step with a visible message. */
  async function work(step: SetupStep, task: () => Promise<void>): Promise<void> {
    setBusy(true)
    setStepAlert(null)
    try {
      await task()
    } catch (error) {
      const text = safeClientMessage(error)
      setStepAlert({ step, text })
      announce(text)
    } finally {
      setBusy(false)
    }
  }

  function saveProfile(): Promise<void> {
    return work('competitors', async () => {
      const next = await client.saveProfile(profileRequest(setup))
      setState(next)
      go('engines')
    })
  }

  function saveEngines(): Promise<void> {
    return work('engines', async () => {
      const projectId = state.profile?.project.id
      if (!projectId) {
        go('competitors')
        return
      }
      const { provider, engines, everyDays } = setup.search
      await services['engines:set']({
        projectId,
        engines: effectiveEngines(engines, provider),
        provider
      })
      // 0 is "on demand only": no scheduled checks, Check now runs one.
      if (everyDays === 0) {
        await services['schedule:updateProject']({ projectId, paused: true })
      } else if (isIntervalDays(everyDays)) {
        await services['schedule:updateProject']({
          projectId,
          defaultIntervalDays: everyDays,
          paused: false
        })
      }
      go('shapes')
    })
  }

  /** Step 8's Continue: the prompts are written to the mix while step 9 opens. */
  function writePrompts(): void {
    const mix = setup.mix
    onDraft((current) => ({ ...current, questionsMix: mix }))
    write(mix)
    go('questions')
  }

  function finish(): Promise<void> {
    return work('questions', async () => {
      const result = await sections.finishSetup(finishRequest(setup, true))
      setState(result.state)
      if (result.message) announce(result.message)
      if (!result.state.finished) {
        setStepAlert({ step: 'questions', text: result.message ?? 'Setup is not finished yet.' })
        return
      }
      autosave.stop()
      onFinished(
        result.topicId === null ? null : projectHash(result.projectId, topicHash(result.topicId))
      )
    })
  }

  function onContinue(step: SetupStep): void {
    if (step === 'competitors') void saveProfile()
    else if (step === 'engines') void saveEngines()
    else if (step === 'shapes') writePrompts()
    else if (step === 'questions') void finish()
    else {
      const next = nextStep(step)
      if (next) go(next)
    }
  }

  const firstCost = checkCost({
    provider: setup.search.provider,
    engines: effectiveEngines(setup.search.engines, setup.search.provider),
    options: engineOptions,
    questions: keptCount(setup, 'questions'),
    everyDays: setup.search.everyDays,
    plan: planFor(setup.search.provider, null)
  })
  const footNote = firstCheckLine(firstCost)
  const balance = searchBalance(keys, setup.search.provider)
  const creditWarning =
    balance !== null && firstCost.perCheck > balance
      ? `Your ${setup.search.provider === 'serpapi' ? 'SerpApi' : 'cloro'} keys have ${balance.toLocaleString('en-US')} ${firstCost.unit === 'credit' ? 'credits' : 'searches'} left, less than this first check needs. Untick some prompts, or add credits or another key on step 7.`
      : null

  function rereadSite(): Promise<FillFromWebsiteResult> {
    const site = setup.site
    const country = site.country === 'other' ? site.countryCode : site.country
    const language = site.language === 'other' ? site.languageCode : site.language
    return client.fillFromWebsite({
      projectId: null,
      domain: normalizeDomain(site.domain),
      market: { country: normalizeCountry(country), language: normalizeLanguageTag(language) },
      brandOnly: true
    })
  }

  function stepProps(step: SetupStep): SetupStepProps {
    return {
      draft: setup,
      onDraft,
      sections,
      onBack: () => go(previousStep(step)),
      onContinue: () => onContinue(step),
      busy,
      alert: stepAlert?.step === step ? stepAlert.text : null,
      announce,
      ...(step === 'questions' ? { footNote } : {}),
      ...(step === 'brand' ? { rereadSite } : {})
    }
  }

  return (
    <SetupChrome
      view={view}
      draft={setup}
      progress={progress}
      announcement={announcement}
      announcementLog={announcementLog}
      notice={autosave.saveFailed ? DRAFT_SAVE_FAILED_NOTICE : null}
      onWelcome={() => go('welcome')}
      client={client}
      onStep={(step) => {
        if (canReach(step, setup, progress)) go(step)
      }}
    >
      {view === 'welcome' ? (
        <WelcomeScreen onStart={() => go(furthestStep(setup, progress))} />
      ) : null}
      {view === 'site' ? <SiteStep {...stepProps('site')} /> : null}
      {view === 'claude' ? (
        <ClaudeStep
          {...stepProps('claude')}
          client={client}
          onChecked={() => {
            void client.getState().then(setState, () => undefined)
            void permissions?.refresh()
            refreshClaude()
          }}
          onAnthropic={async (secret) => {
            const outcome = await saveAnthropic(secret)
            void permissions?.refresh()
            return outcome
          }}
        />
      ) : null}
      {view === 'read' ? (
        <ReadStep
          {...stepProps('read')}
          read={read}
          services={services}
          claudeAvailable={claude.available}
          claudeReason={claude.reason}
          {...(openLink ? { openLink } : {})}
        />
      ) : null}
      {view === 'brand' ? <BrandStep {...stepProps('brand')} /> : null}
      {view === 'buyers' ? <BuyersStep {...stepProps('buyers')} /> : null}
      {view === 'competitors' ? (
        <CompetitorsStep
          {...stepProps('competitors')}
          searches={{ live: read.live, retry: read.retry }}
        />
      ) : null}
      {view === 'engines' ? (
        <EnginesStep
          {...stepProps('engines')}
          client={client}
          services={services}
          projectId={state.profile?.project.id ?? null}
          keys={keys}
          onKey={remember}
          onOptions={setEngineOptions}
        />
      ) : null}
      {view === 'shapes' ? (
        <ShapesStep
          {...stepProps('shapes')}
          keys={keys}
          engineOptions={engineOptions}
          examples={examples}
          claudeAvailable={claude.available}
        />
      ) : null}
      {view === 'questions' ? (
        <QuestionsStep {...stepProps('questions')} writer={writer} creditWarning={creditWarning} />
      ) : null}
    </SetupChrome>
  )
}
