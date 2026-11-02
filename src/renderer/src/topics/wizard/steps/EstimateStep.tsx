import { useEffect, useId, useState, type JSX } from 'react'
import {
  intervalDaysText,
  isIntervalDays,
  QUICK_INTERVAL_DAYS,
  TOPIC_STAGE_LABEL,
  type IntervalDays
} from '@shared/domain'
import type { TopicEstimate, TopicStartPlan } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { Button, Chip, KpiStrip, KpiTile, Panel, SegmentedControl, UiIcon } from '../../../ui'
import { StepFrame } from '../components/StepFrame'
import { included, keywordsOf, profilePoints, questionsOf, stepProblem } from '../utils/draft'
import { FIT_LABEL, FIT_TONE, rangeText, startLabel } from '../utils/estimate'
import type { StepProps } from './shared'

type Scope = 'questions' | 'keywords' | 'both'

/** The choices, plus the draft's own interval when it is another one (60 or 90). */
function recheckOptions(current: IntervalDays): { value: string; label: string }[] {
  const quick: readonly IntervalDays[] = QUICK_INTERVAL_DAYS
  const days = quick.includes(current) ? quick : [...quick, current]
  return days.map((day) => ({ value: String(day), label: intervalDaysText(day) }))
}

const SOURCE_LINE = {
  seed: 'A seed',
  questions: 'Your own questions',
  competitor: "A competitor's page"
} as const

function renewLabel(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Estimate and start (Seed-Estimate.png): searches needed, plans that fit, Start. */
export function EstimateStep(props: StepProps): JSX.Element {
  const { draft, project, client, flush, patch } = props
  const questions = included(questionsOf(draft))
  const keywords = included(keywordsOf(draft))
  const defaultScope: Scope = questions.length > 0 ? 'questions' : 'keywords'
  const [scope, setScope] = useState<Scope>(defaultScope)
  const [estimate, setEstimate] = useState<TopicEstimate | null>(null)
  const [plan, setPlan] = useState<TopicStartPlan | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const radioName = useId()
  const draftKey = draft.id
  const marketCount = draft.marketIds.length

  useEffect(() => {
    let cancelled = false
    void flush()
      .then((saved) =>
        client['topics:estimate']({ projectId: project.id, draftId: saved?.id ?? draftKey, scope })
      )
      .then(
        (next) => {
          if (cancelled) return
          setLoadError(null)
          setEstimate(next)
          setPlan(
            (current) =>
              current ??
              next.plans.find((option) => option.suggested)?.plan ??
              next.plans[0]?.plan ??
              null
          )
        },
        (cause: unknown) => {
          if (!cancelled) setLoadError(errorText(cause, 'Could not work out the estimate.'))
        }
      )
    return () => {
      cancelled = true
    }
  }, [client, project.id, draftKey, flush, scope, questions.length, keywords.length, marketCount])

  const chosen = estimate?.plans.find((option) => option.plan === plan) ?? null
  const left = estimate?.searchesLeft ?? null
  const low = left !== null && estimate !== null && estimate.searchesHi > left
  const stageLabel = chosen?.firstStage ? TOPIC_STAGE_LABEL[chosen.firstStage] : null
  const recheck =
    estimate?.recheck.find((row) => row.intervalDays === draft.intervalDays) ?? estimate?.recheck[0]
  const problem = stepProblem(draft, 'estimate')
  const markets = project.markets.filter((market) => draft.marketIds.includes(market.id))
  const profile = draft.profile ? `profile v${draft.profile.current}` : null

  async function start(): Promise<void> {
    if (!chosen) return
    setStarting(true)
    setStartError(null)
    try {
      const saved = (await flush()) ?? draft
      const result = await client['topics:start']({
        projectId: project.id,
        draftId: saved.id,
        plan: chosen.plan,
        scope,
        stage: chosen.firstStage,
        group: chosen.firstGroup,
        intervalDays: draft.intervalDays
      })
      if (result.jobId === null && result.message) setStartError(result.message)
      props.onStarted(result, saved)
    } catch (cause) {
      setStartError(errorText(cause, 'Could not start the topic.'))
    } finally {
      setStarting(false)
    }
  }

  const scopes: { value: Scope; label: string }[] = [
    ...(questions.length > 0 ? [{ value: 'questions' as const, label: 'Questions' }] : []),
    ...(keywords.length > 0 ? [{ value: 'keywords' as const, label: 'Keywords' }] : []),
    ...(questions.length > 0 && keywords.length > 0
      ? [{ value: 'both' as const, label: 'Both' }]
      : [])
  ]
  const leftShare =
    left !== null && estimate
      ? Math.min(100, (left / Math.max(left, estimate.searchesHi)) * 100)
      : 0
  const needShare =
    left !== null && estimate
      ? Math.min(100, (estimate.searchesHi / Math.max(left, estimate.searchesHi)) * 100)
      : 0

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Estimate and start"
      aside="Nothing has used a search yet."
      footer={{
        onBack: props.back,
        note: startError ?? loadError ?? problem ?? 'Opens the topic while it checks',
        noteTone: startError || loadError || problem ? 'warn' : 'neutral',
        primary: {
          label: chosen ? startLabel(chosen, stageLabel) : 'Start',
          busy: starting,
          disabled: !chosen || Boolean(problem),
          onClick: () => void start()
        }
      }}
    >
      <div className="tw-grid">
        <div className="tw-main">
          <KpiStrip className="tw-kpis">
            <KpiTile
              label={
                scope === 'keywords'
                  ? 'Keywords'
                  : scope === 'both'
                    ? 'Questions'
                    : 'Buyer questions'
              }
              value={
                estimate?.prompts ?? (scope === 'keywords' ? keywords.length : questions.length)
              }
              sub={
                estimate
                  ? scope === 'keywords'
                    ? `${estimate.groups} groups · ${estimate.markets} ${estimate.markets === 1 ? 'market' : 'markets'}`
                    : `${estimate.stages} stages · ${estimate.markets} ${estimate.markets === 1 ? 'market' : 'markets'}`
                  : ' '
              }
            />
            <KpiTile
              label="Searches needed"
              value={estimate ? rangeText(estimate.searchesLo, estimate.searchesHi) : '…'}
              sub="Up to 2 per question"
            />
            <KpiTile
              label="Left this month"
              className={low ? 'tw-kpi-low' : undefined}
              value={left === null ? '—' : left.toLocaleString('en-US')}
              sub={estimate ? `Searches renew ${renewLabel(estimate.renewsOn)}` : ' '}
            />
          </KpiStrip>
          <Panel
            title="How to run the first check"
            padding={0}
            actions={
              scopes.length > 1 ? (
                <SegmentedControl
                  label="What to check"
                  size="sm"
                  options={scopes}
                  value={scope}
                  onChange={setScope}
                />
              ) : null
            }
            className="tw-plans-panel"
          >
            <fieldset className="tw-plans">
              <legend className="sr-only">How to run it</legend>
              {estimate?.plans.map((option) => {
                const on = option.plan === plan
                return (
                  <label key={option.plan} className={on ? 'tw-plan on' : 'tw-plan'}>
                    <input
                      type="radio"
                      name={radioName}
                      checked={on}
                      onChange={() => setPlan(option.plan)}
                    />
                    <span className="tw-plan-copy">
                      <span className="tw-plan-title">
                        {option.label}
                        {option.suggested ? (
                          <span className="tw-plan-suggested">
                            <UiIcon name="sparkle" size={12} /> Suggested
                          </span>
                        ) : null}
                      </span>
                      <span className="tw-help num">{option.detail}</span>
                    </span>
                    <Chip size="sm" tone={FIT_TONE[option.fit]}>
                      {FIT_LABEL[option.fit]}
                    </Chip>
                  </label>
                )
              }) ?? <p className="tw-muted">Working out the estimate…</p>}
            </fieldset>
            <div className="tw-recheck">
              <span className="tw-recheck-label">Re-check every</span>
              <SegmentedControl
                label="Re-check every"
                options={recheckOptions(draft.intervalDays)}
                value={String(draft.intervalDays)}
                onChange={(value) => {
                  const days = Number(value)
                  if (isIntervalDays(days)) patch({ intervalDays: days })
                }}
              />
              {recheck ? (
                <span className="tw-help num">
                  About {rangeText(recheck.monthlyLo, recheck.monthlyHi)} searches a month
                </span>
              ) : null}
            </div>
          </Panel>
        </div>
        <aside className="tw-rail" aria-label="Topic summary">
          <Panel title={draft.name || 'New topic'}>
            <dl className="tw-kv">
              <div>
                <dt>Started from</dt>
                <dd>{[SOURCE_LINE[draft.path], profile].filter(Boolean).join(' · ')}</dd>
              </div>
              {questionsOf(draft).length > 0 ? (
                <div>
                  <dt>Questions</dt>
                  <dd className="num">
                    {questions.length} of {questionsOf(draft).length} · goal{' '}
                    {draft.bands.questions.lo}–{draft.bands.questions.hi}%
                  </dd>
                </div>
              ) : null}
              {keywordsOf(draft).length > 0 ? (
                <div>
                  <dt>Keywords</dt>
                  <dd className="num">
                    {keywords.length} in {new Set(keywords.map((k) => k.kwGroup)).size} groups ·
                    goal {draft.bands.keywords.lo}–{draft.bands.keywords.hi}%
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Markets</dt>
                <dd>{markets.map((market) => market.label).join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Target pages</dt>
                <dd className="num">
                  {estimate
                    ? `${estimate.targets.set} set · ${estimate.targets.noPage} no page yet`
                    : '…'}
                </dd>
              </div>
            </dl>
            <div className="tw-rail-links">
              {props.steps.some((step) => step.id === 'questions') ? (
                <Button size="sm" variant="text" onClick={() => props.goTo('questions')}>
                  Edit questions
                </Button>
              ) : props.steps.some((step) => step.id === 'cleanup') ? (
                <Button size="sm" variant="text" onClick={() => props.goTo('cleanup')}>
                  Edit questions
                </Button>
              ) : null}
              <Button size="sm" variant="text" onClick={() => props.goTo('pages')}>
                Edit pages
              </Button>
            </div>
            {profilePoints(draft).length === 0 &&
            draft.path === 'seed' &&
            draft.generate !== 'keywords' ? (
              <p className="tw-help">No buyer profile yet.</p>
            ) : null}
          </Panel>
          <Panel title="Searches this month">
            <div className="tw-budget" aria-hidden="true">
              <span className="tw-budget-left" style={{ width: `${leftShare}%` }} />
              <span className="tw-budget-need" style={{ width: `${needShare}%` }} />
            </div>
            <div className="tw-budget-legend num">
              <span>
                <span className="tw-swatch tw-swatch-left" aria-hidden="true" />
                Left: {left === null ? '—' : left.toLocaleString('en-US')}
              </span>
              <span>
                <span className="tw-swatch tw-swatch-need" aria-hidden="true" />
                This check: {estimate ? rangeText(estimate.searchesLo, estimate.searchesHi) : '…'}
              </span>
            </div>
            {estimate?.note ? (
              <p className="tw-warn-box">
                <UiIcon name="warning" size={16} />
                <span>{estimate.note}</span>
              </p>
            ) : null}
            <a className="tw-text-link" href="#/connections">
              Add another search key
            </a>
          </Panel>
        </aside>
      </div>
    </StepFrame>
  )
}
