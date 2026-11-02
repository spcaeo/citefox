import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { TopicDraftSummary, TopicWizardStep } from '@shared/domain'
import type { TopicSuggestedStart } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { LoadError } from '../../components/LoadError'
import { currentClientMode } from '../../onboarding/flags'
import { usePermissions } from '../../ui/permissionsContext'
import { landingHash, navigateHash, sectionHash } from '../../shell/routes'
import { createTopicsClient, type TopicsClient } from './client'
import { ChooserScreen, type ChooserPick } from './components/ChooserScreen'
import { useWizardDraft } from './hooks/useWizardDraft'
import { addHash, topicHash } from './routes'
import { startWay } from './startWay'
import { StepSwitch } from './steps/StepSwitch'
import type { WizardProject } from './types'
import { currentStep, previousStep, stepsFor } from './utils/steps'
import './wizard.css'
import './wizard-steps.css'

export type { WizardProject } from './types'

/**
 * The Add wizard (Docs/TOPICS-SPEC.md §3): `#/add` shows "What do you want to
 * track?"; `#/add/<draftId>` opens a saved draft at its step. Every path ends
 * in Start, which creates the topic and opens its results while it checks.
 */
export function TopicWizard({
  project,
  draftId,
  client: given
}: {
  project: WizardProject | null
  draftId: string | null
  /** Tests only. Production picks the client from the client mode. */
  client?: TopicsClient
}): JSX.Element {
  const client = useMemo(() => given ?? createTopicsClient(currentClientMode()), [given])
  if (!project) {
    return (
      <div className="tw tw-empty">
        <div className="tw-body">
          <h1>Add page or topic</h1>
          <p className="tw-muted">Open or create a project first.</p>
        </div>
      </div>
    )
  }
  return draftId ? (
    <WizardFlow key={draftId} client={client} project={project} draftId={draftId} />
  ) : (
    <Chooser client={client} project={project} />
  )
}

function Chooser({
  client,
  project
}: {
  client: TopicsClient
  project: WizardProject
}): JSX.Element {
  const [suggested, setSuggested] = useState<TopicSuggestedStart | null>(null)
  const [drafts, setDrafts] = useState<readonly TopicDraftSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The suggested start is a Claude call nobody clicked for: it runs only when Claude is
  // ready. Outside the permissions provider (component tests) there is no gate.
  const permissions = usePermissions()
  const claudeState = permissions === null ? 'ready' : (permissions.claude?.state ?? null)
  const claudeReady = claudeState === 'ready'

  useEffect(() => {
    let cancelled = false
    client['topics:listDrafts']({ projectId: project.id }).then(
      (list) => {
        if (!cancelled) setDrafts(list.drafts)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client, project.id])

  useEffect(() => {
    if (!claudeReady) return
    let cancelled = false
    client['topics:suggestedStart']({ projectId: project.id }).then(
      (result) => {
        if (!cancelled) setSuggested(result.suggestion)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client, project.id, claudeReady])

  const onContinue = useCallback(
    async (pick: ChooserPick, seed?: string, productId?: string | null) => {
      if (pick === 'page') {
        navigateHash(sectionHash('add-page'))
        return
      }
      setBusy(true)
      setError(null)
      try {
        navigateHash(await startWay(client, project.id, pick, seed, productId))
      } catch (cause) {
        setError(errorText(cause, 'Could not start the topic.'))
      } finally {
        setBusy(false)
      }
    },
    [client, project.id]
  )

  return (
    <ChooserScreen
      project={project}
      suggested={suggested}
      claudeMissing={claudeState !== null && !claudeReady}
      onCheckClaude={
        claudeState === 'unchecked' && permissions !== null
          ? () => void permissions.ensureClaude()
          : undefined
      }
      drafts={drafts}
      busy={busy}
      error={error}
      onContinue={(pick, seed, productId) => void onContinue(pick, seed, productId)}
      onResume={(id) => navigateHash(addHash(id))}
      onCancel={() => navigateHash(landingHash())}
    />
  )
}

function WizardFlow({
  client,
  project,
  draftId
}: {
  client: TopicsClient
  project: WizardProject
  draftId: string
}): JSX.Element {
  const state = useWizardDraft(client, project.id, draftId)
  const { draft, patch, flush } = state

  // A draft whose markets are not in the project (removed since, or a fresh
  // draft from another source) checks the project's default market instead.
  const marketsKnown =
    !draft ||
    project.markets.length === 0 ||
    draft.marketIds.some((id) => project.markets.some((market) => market.id === id))
  useEffect(() => {
    const first = project.markets[0]
    if (!marketsKnown && first) patch({ marketIds: [first.id] })
  }, [marketsKnown, project.markets, patch])

  const goTo = useCallback(
    (step: TopicWizardStep) => {
      patch({ step })
      void flush()
    },
    [patch, flush]
  )

  if (state.loading) return <p role="status">Loading the draft…</p>
  if (!draft) {
    return (
      <LoadError
        title="CiteFox could not open this draft."
        message={state.loadError}
        onRetry={state.reload}
      />
    )
  }
  const step = currentStep(draft)
  const back = (): void => {
    const previous = previousStep(draft, step)
    if (previous) goTo(previous)
    else {
      void flush()
      navigateHash(addHash())
    }
  }
  return (
    <>
      <StepSwitch
        draft={draft}
        project={project}
        client={client}
        steps={stepsFor(draft)}
        step={step}
        patch={patch}
        replace={state.replace}
        flush={flush}
        goTo={goTo}
        back={back}
        onStarted={(result) => navigateHash(topicHash(result.topicId))}
      />
      {state.saveError ? (
        <p className="tw-save-error" role="alert">
          {state.saveError}
        </p>
      ) : null}
    </>
  )
}
