import { useMemo, useState, type JSX, type ReactNode } from 'react'
import type { Market } from '@shared/domain'
import type { ImportEstimateRequest, ImportTrackResult, ProjectDetail } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { ScreenHeader } from '../components/Header'
import { DrillHost } from '../drill'
import { navigateHash, sectionHash } from '../shell/routes'
import type { StructureClient } from '../structure/client'
import { EmptyState, LinkButton, SectionHead, Stepper, WizardFooter, type StepperStep } from '../ui'
import { formatDay } from '../utils/dates'
import { useQueryChoice } from '../utils/queryState'
import { ChooseStep } from './components/ChooseStep'
import { ClaudePick } from './components/ClaudePick'
import { CostEstimate } from './components/CostEstimate'
import { HowToTrack } from './components/HowToTrack'
import { PreviewGrid } from './components/PreviewGrid'
import { SourceStep } from './components/SourceStep'
import { DEFAULT_TRACK } from './constants'
import { useEstimate } from './hooks/useEstimate'
import { errorMessage, useImportCandidates } from './hooks/useImportCandidates'
import { toDraft, useMarketChoices } from './hooks/useMarketChoices'
import { useSelection } from './hooks/useSelection'
import type { TrackSettings } from './types'
import { fmt, type EstimateInputs } from './utils/estimate'
import { mergePool, previewRows, rowKey, selectedRows, trackPayload } from './utils/selection'
import './importPages.css'

const NO_MARKETS: readonly Market[] = []

type StepId = 'pages' | 'preview' | 'track'

/** The open step is `?step=` in the route; Pages, the first, has none. */
const STEP_IDS: readonly StepId[] = ['pages', 'preview', 'track']

const STEPS: readonly StepperStep[] = [
  { id: 'pages', label: 'Pages' },
  { id: 'preview', label: 'Preview' },
  { id: 'track', label: 'How to track' }
]

function header(project: ProjectDetail | null): JSX.Element {
  return (
    <ScreenHeader
      nav={{ back: { href: sectionHash('pages'), label: project?.name ?? 'All pages' } }}
      title="Import pages"
      subtitle={
        <p className="section-subtitle">
          Bring in pages from your sitemap, then choose which to track. Untracked pages cost
          nothing.
        </p>
      }
    />
  )
}

/**
 * FR-20.6 Import pages as a v2 wizard (Theme "Layouts"): the back row and
 * title, then the stepper, Pages (source and choice) → Preview → How to track, and a sticky
 * footer with Back, the cost line and one primary action.
 */
export function ImportPagesScreen({
  client,
  project,
  onTracked
}: {
  client: StructureClient
  project: ProjectDetail | null
  onTracked: (result: ImportTrackResult) => void
}): JSX.Element {
  if (!project) {
    return (
      <div className="page-stack imp">
        {header(project)}
        <div className="imp-card">
          <EmptyState
            title="Create a project before importing pages."
            action={
              <LinkButton variant="primary" size="sm" href={sectionHash('new-project')}>
                New project
              </LinkButton>
            }
          />
        </div>
      </div>
    )
  }
  return (
    <DrillHost>
      <ImportFlow
        key={project.id}
        client={client}
        project={project}
        onTracked={onTracked}
        head={header(project)}
      />
    </DrillHost>
  )
}

function ImportFlow({
  client,
  project,
  onTracked,
  head
}: {
  client: StructureClient
  project: ProjectDetail
  onTracked: (result: ImportTrackResult) => void
  head: ReactNode
}): JSX.Element {
  const projectId = project.id
  const candidates = useImportCandidates(client, projectId)
  const [state, actions] = useSelection()
  const markets = useMarketChoices(candidates.list?.markets ?? NO_MARKETS)
  const [step, setStep] = useQueryChoice('step', STEP_IDS, 'pages')
  const [settings, setSettings] = useState<TrackSettings>(DEFAULT_TRACK)
  const [promptText, setPromptText] = useState(String(DEFAULT_TRACK.promptCount))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const pool = useMemo(
    () => mergePool(candidates.list?.rows ?? [], state.pasted),
    [candidates.list, state.pasted]
  )
  const preview = useMemo(() => previewRows(pool, state, now), [pool, state, now])
  const chosen = useMemo(() => selectedRows(preview, state.off), [preview, state.off])
  const aiApplied = useMemo(() => {
    const keys = new Set(state.aiKeys)
    return pool.filter((row) => keys.has(rowKey(row)) && !row.alreadyTracked).length
  }, [pool, state.aiKeys])
  const prompts = Number(promptText)
  const promptOk = Number.isInteger(prompts) && prompts >= 1 && prompts <= 50
  const onMarkets = markets.choices.filter((choice) => choice.on)
  const setupPages = chosen.filter((row) => row.pageId === null || row.needsSetup).length
  const inputs: EstimateInputs = {
    pages: chosen.length,
    setupPages,
    prompts: promptOk ? prompts : 0,
    markets: onMarkets.length,
    samples: settings.samples,
    intervalDays: settings.intervalDays,
    stagger: settings.stagger
  }
  const estimateRequest: ImportEstimateRequest | null =
    chosen.length > 0 && onMarkets.length > 0 && promptOk
      ? {
          projectId,
          pageCount: chosen.length,
          setupPageCount: setupPages,
          marketCount: onMarkets.length,
          promptCount: prompts,
          samples: settings.samples,
          intervalDays: settings.intervalDays,
          stagger: settings.stagger
        }
      : null
  const estimate = useEstimate(client, estimateRequest)

  async function track(): Promise<void> {
    setError(null)
    setDone(null)
    if (!promptOk) {
      setError('Enter a whole number of questions per page, from 1 to 50.')
      return
    }
    if (onMarkets.length === 0) {
      setError('Tick at least one market.')
      return
    }
    const payload = trackPayload(chosen)
    setBusy(true)
    try {
      const result = await client['import:track']({
        projectId,
        pageIds: payload.pageIds,
        urls: payload.urls,
        markets: onMarkets.map(toDraft),
        intervalDays: settings.intervalDays,
        samples: settings.samples,
        promptCount: prompts,
        stagger: settings.stagger,
        ...(payload.labels.length > 0 ? { labels: payload.labels } : {})
      })
      const spread =
        result.firstCheckFrom && result.firstCheckUntil
          ? result.firstCheckFrom.slice(0, 10) === result.firstCheckUntil.slice(0, 10)
            ? ` First checks start ${formatDay(result.firstCheckFrom)}.`
            : ` First checks spread from ${formatDay(result.firstCheckFrom)} to ${formatDay(result.firstCheckUntil)}.`
          : ''
      setDone(`Tracking ${pluralize(result.trackedCount, 'page')}.${spread}`)
      actions.reset()
      await candidates.reload()
      onTracked(result)
    } catch (cause) {
      setError(errorMessage(cause, 'Could not track those pages.'))
    } finally {
      setBusy(false)
    }
  }

  const cost = estimate.estimate
  const note =
    chosen.length === 0
      ? 'No searches are used until pages are tracked.'
      : cost && estimateRequest
        ? `${pluralize(chosen.length, 'page')} · ${fmt(cost.minSearches)}–${fmt(cost.maxSearches)} searches per check`
        : `${pluralize(chosen.length, 'page')} chosen`
  const over = Boolean(cost && (cost.firstRoundFits === false || cost.monthlyFits === false))

  function go(next: StepId): void {
    setStep(next)
    setError(null)
    requestAnimationFrame(() => {
      document.getElementById('imp-top')?.scrollIntoView({ block: 'start' })
    })
  }

  return (
    <div className="page-stack imp" id="imp-top">
      {head}
      <div className="imp-stepper">
        <Stepper
          label="Import steps"
          steps={STEPS}
          current={step}
          onStep={(id) => go(id as StepId)}
        />
      </div>
      {step === 'pages' ? (
        <>
          <SourceStep
            client={client}
            projectId={projectId}
            domain={project.domain}
            list={candidates.list}
            onSitemapRead={candidates.reload}
            onPasted={actions.addPasted}
          />
          {candidates.error ? (
            <p className="field-error" role="alert">
              {candidates.error}
            </p>
          ) : null}
          {candidates.list ? (
            <ChooseStep
              list={candidates.list}
              pool={pool}
              state={state}
              actions={actions}
              now={now}
              claudePick={
                <ClaudePick
                  client={client}
                  projectId={projectId}
                  appliedCount={aiApplied}
                  rows={pool}
                  onApply={(pageIds) => actions.setAiKeys(pageIds)}
                />
              }
            />
          ) : candidates.loading ? (
            <p role="status" className="muted">
              Loading the pages CiteFox found…
            </p>
          ) : null}
        </>
      ) : null}
      {step === 'preview' ? (
        <section className="imp-step imp-step-flat" aria-labelledby="imp-preview-title">
          <SectionHead
            id="imp-preview-title"
            title="Preview"
            description={`${pluralize(chosen.length, 'page')} to track. Untick a page to leave it out.`}
          />
          <PreviewGrid
            rows={preview}
            off={state.off}
            selectedCount={chosen.length}
            onToggle={actions.toggleOff}
            onSetOff={actions.setOff}
          />
        </section>
      ) : null}
      {step === 'track' ? (
        <HowToTrack
          choices={markets.choices}
          onToggleMarket={markets.toggle}
          onAddMarket={markets.add}
          settings={settings}
          promptText={promptText}
          onPromptText={setPromptText}
          onSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        >
          <CostEstimate
            inputs={inputs}
            estimate={estimate.estimate}
            error={estimate.error}
            pending={estimate.pending}
          />
        </HowToTrack>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="imp-done" role="status">
          {done}
        </p>
      ) : null}
      <WizardFooter
        onBack={
          step === 'pages'
            ? () => navigateHash(sectionHash('pages'))
            : () => go(step === 'track' ? 'preview' : 'pages')
        }
        backLabel={step === 'pages' ? 'Cancel' : 'Back'}
        note={note}
        noteTone={over ? 'warn' : 'neutral'}
        primary={
          step === 'pages'
            ? {
                label: `Preview ${pluralize(chosen.length, 'page')}`,
                disabled: chosen.length === 0,
                onClick: () => go('preview')
              }
            : step === 'preview'
              ? {
                  label: 'Choose how to track',
                  disabled: chosen.length === 0,
                  onClick: () => go('track')
                }
              : {
                  label: busy ? 'Tracking…' : `Track ${pluralize(chosen.length, 'page')}`,
                  disabled: busy || chosen.length === 0,
                  busy,
                  icon: null,
                  onClick: () => void track()
                }
        }
      />
    </div>
  )
}
