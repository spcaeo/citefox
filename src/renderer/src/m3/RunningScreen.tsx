import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { BuyerPrompt, Market, SampleCount } from '@shared/domain'
import type { CheckJob, CheckMarketProgress, CheckStepSnapshot } from '@shared/ipc'
import { HeaderActions, type HeaderMoreItem } from '../components/HeaderActions'
import { Icon } from '../components/Icon'
import {
  Button,
  KpiStrip,
  KpiTile,
  ListGrid,
  SectionHead,
  buttonClass,
  type ListColumn
} from '../ui'
import { Markdown } from '../components/Markdown'
import { SponsorSlot } from '../components/SponsorSlot'
import { marketLabel } from '../shell/model'
import {
  navigateHash,
  pageHash,
  promptHash,
  readHash,
  runningHash,
  sectionHash
} from '../shell/routes'
import { ClockMark, DoneMark, Sep, Spinner } from './bits'
import { checkingHeading, countNoun, formatClock } from './model'
import { checkPlanLine, checkStartCopy } from './checkPlan'
import { queuedPrompts, runningRows, stepBusy, stepSettled, type RunningTableRow } from './running'
import './m3.css'
import './running.css'

const SETUP = [
  { id: 'read', label: 'Read page' },
  { id: 'profile', label: 'Buyer profile' },
  { id: 'prompts', label: 'Questions' },
  { id: 'check', label: 'First check' }
] as const

/**
 * Checking screen. `job` mirrors `CheckJob` (`checks:get` / the snapshot behind `checks:progress`).
 * `samples` is the page's existing `SampleCount`. Prompt wording is `CheckStepSnapshot.promptText`.
 * The short per-step sentence is `CheckStepSnapshot.error`. The explain-errors essay stays hidden
 * (M3+ decision 25).
 */
export function RunningScreen({
  pageId,
  samples,
  markets,
  job,
  onCancel,
  onStart,
  starting = false,
  finished = false,
  promptCatalog = [],
  alertId,
  focusStart = false,
  showSponsor = true,
  checkedBefore = false
}: {
  pageId: string
  samples: SampleCount
  markets: readonly Market[]
  /** Null when `checks:listActive` has no running job for this page. */
  job: CheckJob | null
  onCancel: () => void
  /** `checks:start` for this page. Hidden while a job is showing or the invoke is pending. */
  onStart: () => void
  /** True from the click until `checks:start` settles. */
  starting?: boolean
  /** `checks:start` resolved with a finished job. The last progress snapshot stays up. */
  finished?: boolean
  /** Enabled prompts from `prompts:list`, so queued rows exist before the first step. */
  promptCatalog?: readonly BuyerPrompt[]
  /** Id of the alert that describes a failed start. */
  alertId?: string
  /** Move focus to the start button after a failed start. */
  focusStart?: boolean
  /** The production shell already renders the sponsor. */
  showSponsor?: boolean
  /** The page has a finished check, so this is a re-check, not the first. */
  checkedBefore?: boolean
}): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const resultsRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!focusStart || starting || finished) return
    startRef.current?.focus()
  }, [focusStart, starting, finished])
  useEffect(() => {
    if (!finished) return
    resultsRef.current?.focus()
  }, [finished])
  const runningProgress =
    job?.markets.find((market) => market.state === 'running') ?? job?.markets[0]
  const activeProgress =
    job?.markets.find((market) => market.marketId === picked) ?? runningProgress
  const activeMarket = markets.find((market) => market.id === activeProgress?.marketId)
  const catalog = queuedPrompts(
    promptCatalog,
    activeProgress?.marketId ?? markets[0]?.id ?? '',
    activeMarket?.language ?? markets[0]?.language ?? 'en',
    job?.promptIds ?? null
  )
  const rows = job ? runningRows(job, activeProgress?.marketId ?? '', catalog) : []
  const promptsPerMarket = activeProgress?.total ?? 0
  const sampleLabel = samples === 1 ? '1 sample per question' : `${samples} samples per question`
  const width = !job || job.total === 0 ? 0 : Math.round((job.done / job.total) * 100)
  const monthUsed = job?.monthUsed ?? null
  const activeMarketId = activeProgress?.marketId ?? null
  const columns = useRunColumns(pageId, activeMarketId)
  const monthLimit = job?.monthLimit ?? null
  const copy = checkStartCopy(checkedBefore)
  const steps = <SetupNav pageId={pageId} checkLabel={copy.step} />
  const title = finished
    ? 'Check finished'
    : checkingHeading(promptsPerMarket, job?.markets.length ?? 0)
  const searchesLabel = finished ? ' searches used, up to ' : ' searches used so far, up to '
  const resultsSoFar: HeaderMoreItem = {
    id: 'results',
    label: 'View results so far',
    icon: 'arrow-right',
    href: pageHash(pageId, 'results')
  }

  if (!job && !finished) {
    return (
      <div className="page-stack m3-screen m3-run-screen">
        {steps}
        <header className="m3-run-head">
          <div className="m3-run-titles">
            <h1>{copy.heading}</h1>
            <p className="faint">
              {countNoun(markets.length, 'market', 'markets')}
              <Sep />
              {sampleLabel}
            </p>
          </div>
          <div className="m3-run-actions">
            <HeaderActions
              more={[resultsSoFar]}
              primary={
                starting ? undefined : (
                  <Button
                    ref={startRef}
                    variant="primary"
                    aria-describedby={alertId}
                    onClick={onStart}
                  >
                    {copy.button}
                  </Button>
                )
              }
            />
          </div>
        </header>
        <div className="m3-run-empty">
          <span className="m3-run-empty-icon" aria-hidden="true">
            <Icon name="search" />
          </span>
          <p className="m3-run-empty-title" role={starting ? 'status' : undefined}>
            {starting ? 'Starting the check…' : 'No check is running.'}
          </p>
          {catalog.length > 0 ? (
            <p className="muted">
              <a
                href={pageHash(pageId, 'prompts')}
                aria-label={`${checkPlanLine(catalog.length, markets.length, samples)} See the questions.`}
              >
                {checkPlanLine(catalog.length, markets.length, samples)}
              </a>
            </p>
          ) : null}
        </div>
        {showSponsor ? <SponsorSlot /> : null}
      </div>
    )
  }

  const marketsDone = job ? job.markets.filter((market) => market.state === 'ok').length : 0
  const runningMarket = markets.find((market) => market.id === runningProgress?.marketId)

  return (
    <div className="page-stack m3-screen m3-run-screen">
      {steps}

      <header className="m3-run-head">
        <div className="m3-run-titles">
          <h1>{title}</h1>
          <p className="faint">
            {countNoun(job?.markets.length ?? markets.length, 'market', 'markets')}
            <Sep />
            {sampleLabel}
            {job ? (
              <>
                <Sep />
                started {formatClock(job.startedAt)}
              </>
            ) : null}
          </p>
        </div>
        <div className="m3-run-actions">
          {finished ? (
            <a
              ref={resultsRef}
              className={buttonClass('primary')}
              href={pageHash(pageId, 'results')}
            >
              View results
              <Icon name="arrow-right" />
            </a>
          ) : (
            // Cancel stays a white button beside the ⋯: it is the one thing to do while it runs.
            <HeaderActions
              more={[resultsSoFar]}
              primary={
                <Button variant="secondary" onClick={onCancel}>
                  Cancel check
                </Button>
              }
            />
          )}
        </div>
      </header>

      {job ? (
        <>
          <KpiStrip className="m3-run-kpis" label="Progress">
            <KpiTile
              label="Questions checked"
              value={
                <span role="status" aria-atomic="true">
                  {job.done}
                </span>
              }
              suffix={` of ${job.total.toLocaleString('en-US')} done`}
              sub={
                <span
                  className="m3-run-bar"
                  role="progressbar"
                  aria-label="Questions checked"
                  aria-valuemin={0}
                  aria-valuemax={job.total}
                  aria-valuenow={job.done}
                >
                  <span style={{ width: `${width}%` }} />
                </span>
              }
            />
            <KpiTile
              label="Searches"
              value={job.searchesUsed.toLocaleString('en-US')}
              suffix=" used"
              chip={
                <a
                  className="m3-run-usage"
                  href={sectionHash('connections')}
                  aria-label="Key usage in Connections"
                >
                  Key usage
                </a>
              }
              sub={
                <>
                  {job.searchesUsed.toLocaleString('en-US')}
                  {searchesLabel}
                  {job.searchesMax.toLocaleString('en-US')}
                  {job.brandSearchesMax > 0 ? (
                    <span>
                      {' '}
                      (incl. up to {job.brandSearchesMax.toLocaleString('en-US')} for brand
                      questions)
                    </span>
                  ) : null}
                  {monthUsed !== null && monthLimit !== null ? (
                    <>
                      <Sep />
                      {monthUsed.toLocaleString('en-US')}
                      {' of '}
                      {monthLimit.toLocaleString('en-US')}
                      {' this month'}
                    </>
                  ) : null}
                </>
              }
            />
            <KpiTile
              label="Markets"
              value={marketsDone}
              suffix={` of ${job.markets.length} done`}
              sub={
                finished || marketsDone === job.markets.length
                  ? 'Every market checked'
                  : `Now: ${runningMarket ? marketLabel(runningMarket) : (runningProgress?.marketId ?? '—')}`
              }
            />
          </KpiStrip>

          <section className="stack-tight m3-now" aria-labelledby="m3-now-title">
            <ul className="m3-markets" aria-label="Markets">
              {job.markets.map((market) => (
                <MarketPill
                  key={market.marketId}
                  market={market}
                  markets={markets}
                  shown={market.marketId === activeProgress?.marketId}
                  onShow={() => setPicked(market.marketId)}
                />
              ))}
            </ul>
            <SectionHead
              id="m3-now-title"
              title={activeMarket ? marketLabel(activeMarket) : (activeProgress?.marketId ?? '')}
              description={
                <span className="m3-now-label">
                  {activeProgress && activeProgress !== runningProgress
                    ? activeProgress.state === 'ok'
                      ? 'Checked'
                      : 'Waiting'
                    : finished
                      ? 'Checked'
                      : 'Market being checked now'}
                  {activeMarket?.localWording ? (
                    <>
                      <Sep />
                      local wording on
                    </>
                  ) : null}
                </span>
              }
            />
            <ListGrid<RunningTableRow>
              label="Questions in the market being checked"
              noun={['question', 'questions']}
              rows={rows}
              rowKey={(row) => row.promptId}
              rowLabel={(row) => `Question ${row.promptPosition}`}
              columns={columns}
              pageSize="all"
              className="m3-run-table"
              isRowCurrent={(row) => stepBusy(row.search?.state)}
              onActivate={(row) => {
                const href = rowHref(pageId, activeMarketId, row)
                if (href) navigateHash(href)
              }}
              empty={<p className="muted">No questions in this market yet.</p>}
            />
            <p className="faint m3-run-foot">
              When Google loads the AI Overview separately, CiteFox fetches it right away; that link
              expires within a minute.
            </p>
          </section>
        </>
      ) : null}

      {finished ? null : (
        <section className="m3-note m3-run-note" aria-label="Background checking">
          <Icon name="info" />
          <p className="muted">
            You can close this window. CiteFox keeps checking from the tray and notifies you when
            it&apos;s done.
          </p>
        </section>
      )}
      {showSponsor ? <SponsorSlot /> : null}
    </div>
  )
}

function SetupNav({ pageId, checkLabel }: { pageId: string; checkLabel: string }): JSX.Element {
  return (
    <nav aria-label="Setup steps" className="m3-run-steps">
      <ol className="ui-stepper">
        {SETUP.map((step, index) => {
          const href =
            step.id === 'read'
              ? readHash(pageId)
              : step.id === 'profile'
                ? pageHash(pageId, 'audience')
                : step.id === 'prompts'
                  ? pageHash(pageId, 'prompts')
                  : runningHash(pageId)
          const current = step.id === 'check'
          return (
            <li
              key={step.id}
              className={`ui-step ${current ? 'ui-step-is-current' : 'ui-step-is-done'}`}
            >
              <a className="ui-step-btn" href={href} aria-current={current ? 'step' : undefined}>
                <span
                  className={`ui-step-mark ${current ? 'ui-step-current' : 'ui-step-done'}`}
                  aria-hidden="true"
                >
                  {current ? index + 1 : <Icon name="check" size="chev" />}
                </span>
                {current ? null : <span className="sr-only">Done: </span>}
                <span className="ui-step-label">
                  {step.id === 'check' ? checkLabel : step.label}
                </span>
              </a>
              {index < SETUP.length - 1 ? (
                <span className="ui-step-line ui-step-line-done" aria-hidden="true" />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function MarketPill({
  market,
  markets,
  shown,
  onShow
}: {
  market: CheckMarketProgress
  markets: readonly Market[]
  /** This market's prompts are in the table below. */
  shown: boolean
  onShow: () => void
}): JSX.Element {
  const known = markets.find((item) => item.id === market.marketId)
  const phase = market.state === 'ok' ? 'done' : market.state === 'running' ? 'running' : 'waiting'
  return (
    <li aria-current={phase === 'running' ? 'step' : undefined}>
      <button
        type="button"
        className={[
          'm3-pill',
          phase === 'running' ? 'now' : phase === 'waiting' ? 'wait' : '',
          shown ? 'm3-pill-shown' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={shown}
        onClick={onShow}
      >
        {phase === 'done' ? <Icon name="check" /> : null}
        {phase === 'running' ? <Spinner /> : null}
        {phase === 'waiting' ? <ClockMark /> : null}
        <span className="m3-pill-label">{known ? marketLabel(known) : market.marketId}</span>{' '}
        <span className="num">
          {market.done}/{market.total}
        </span>
        <span className="sr-only">
          {phase === 'done' ? ', done' : phase === 'running' ? ', in progress' : ', waiting'}
          {shown ? ', shown below' : ', show its questions'}
        </span>
      </button>
    </li>
  )
}

/** A finished row opens that prompt's detail in this market. */
function rowHref(pageId: string, marketId: string | null, row: RunningTableRow): string | null {
  if (!stepSettled(row.analysis?.state) || !marketId) return null
  return promptHash(pageId, row.promptId, { marketId })
}

/** The run grid's columns: #, prompt, then each step. Finished steps link to Prompt detail. */
function useRunColumns(pageId: string, marketId: string | null): ListColumn<RunningTableRow>[] {
  return useMemo<ListColumn<RunningTableRow>[]>(
    () => [
      {
        id: 'n',
        label: '#',
        width: 40,
        numeric: true,
        render: (row) => <span className="faint">{row.promptPosition}</span>
      },
      {
        id: 'prompt',
        label: 'Question',
        width: 'fill',
        minWidth: 200,
        render: (row) => (
          <span className="m3-clamp">
            <Markdown inline baseLevel={3}>
              {row.text}
            </Markdown>
          </span>
        )
      },
      {
        id: 'search',
        label: 'Google search',
        width: 168,
        render: (row) => <SearchCell step={row.search} />
      },
      {
        id: 'aio',
        label: 'AI Overview',
        width: 136,
        render: (row) => {
          const href = rowHref(pageId, marketId, row)
          if (stepSettled(row.aio?.state)) {
            return href ? (
              <a
                className="m3-ok"
                href={href}
                aria-label={`AI Overview ${row.aio?.detail || 'Loaded'}: read it for question ${row.promptPosition}`}
              >
                <Icon name="check" />
                {row.aio?.detail || 'Loaded'}
              </a>
            ) : (
              <span className="m3-ok">
                <Icon name="check" />
                {row.aio?.detail || 'Loaded'}
              </span>
            )
          }
          if (row.aio?.state === 'error') return <StepFailed text="Not loaded" />
          return <span className="faint">Waiting</span>
        }
      },
      {
        id: 'analysis',
        label: 'Analysis',
        width: 104,
        render: (row) => {
          const href = rowHref(pageId, marketId, row)
          if (!stepSettled(row.analysis?.state)) return <span className="faint">Waiting</span>
          return href ? (
            <a href={href} aria-label={`Analysis done: open question ${row.promptPosition}`}>
              <DoneMark />
            </a>
          ) : (
            <DoneMark />
          )
        }
      }
    ],
    [pageId, marketId]
  )
}

function SearchCell({ step }: { step: CheckStepSnapshot | null }): JSX.Element {
  if (stepSettled(step?.state)) {
    return (
      <span>
        <DoneMark />
        {step && (step.error ?? step.detail).length > 0 ? (
          <span className="faint m3-run-detail">
            {step.error ?? step.detail}
            {step.error ? (
              <>
                {' '}
                <a href={sectionHash('status')}>See Status</a>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    )
  }
  if (step?.state === 'error') {
    return (
      <span>
        <StepFailed text={step.error ?? (step.detail || 'Search failed.')} />{' '}
        <a href={sectionHash('status')}>See Status</a>
      </span>
    )
  }
  if (stepBusy(step?.state)) {
    return (
      <span className="m3-searching">
        <Spinner />
        Searching…
      </span>
    )
  }
  return <span className="faint">Waiting</span>
}

/** A step that ended in an error. It is finished, so it never reads "Waiting". */
function StepFailed({ text }: { text: string }): JSX.Element {
  return (
    <span className="m3-failed">
      <Icon name="warning" />
      {text}
    </span>
  )
}
