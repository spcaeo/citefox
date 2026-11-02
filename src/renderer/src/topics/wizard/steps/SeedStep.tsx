import { useId, useRef, useState, type JSX } from 'react'
import {
  MAX_TOPIC_QUESTIONS,
  QUESTION_DEPTH_TOTAL,
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL,
  type DepthPreset,
  type TopicGenerate
} from '@shared/domain'
import type { DiscoverSeedResult } from '@shared/ipc'
import { AiMenu, Button, Panel, SegmentedControl } from '../../../ui'
import { TopicProductFact, TopicProductPicker } from '../../../products/TopicProductFact'
import { DiscoveryCard } from '../components/DiscoveryCard'
import { StepFrame } from '../components/StepFrame'
import { MAX_PER_STAGE, QUESTION_DEPTH_LINE } from '../constants'
import { READS_SITE, useAiRun } from '../hooks/useAiRun'
import { perStageFor, profilePoints, questionTarget, stepProblem } from '../utils/draft'
import { usePrimary, type StepProps } from './shared'

const GENERATE_OPTIONS: readonly { value: TopicGenerate; label: string }[] = [
  { value: 'questions', label: 'Buyer questions' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'both', label: 'Both' }
]

const DEPTH_OPTIONS: readonly { value: DepthPreset; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep', label: 'Deep' },
  { value: 'custom', label: 'Custom' }
]

/** Seed (Seed-Input.png): the problem, the business, what to generate, brand and markets. */
export function SeedStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush } = props
  const primary = usePrimary(props)
  const discovery = useAiRun<DiscoverSeedResult>()
  const [brandOpen, setBrandOpen] = useState(false)
  const [showProblem, setShowProblem] = useState(false)
  const seedBefore = useRef<{
    seed: string
    name: string
    productId: string | null | undefined
  } | null>(null)
  const ids = { seed: useId(), name: useId(), site: useId(), about: useId(), help: useId() }
  const nameTouched = useRef(draft.name !== draft.seed && draft.name.trim().length > 0)

  const problem = stepProblem(draft, 'seed')
  const keywordsOnly = draft.generate === 'keywords'
  const hasProfile = profilePoints(draft).length > 0
  const questionsDepth = draft.depth.questions

  function setSeed(seed: string): void {
    patch(nameTouched.current ? { seed } : { seed, name: seed })
  }

  function discover(): void {
    discovery.run({
      id: 'discover',
      title: `From ${draft.website || project.domain}`,
      seconds: 25,
      reads: READS_SITE,
      call: async () => {
        const saved = (await flush()) ?? draft
        return client['topics:discoverSeed']({ projectId: project.id, draftId: saved.id })
      }
    })
  }

  function setDepth(preset: DepthPreset): void {
    if (preset === 'custom') {
      patch({ questionDepth: { preset, perStage: questionsDepth.perStage } })
    } else {
      patch({ questionDepth: { preset, perStage: perStageFor(QUESTION_DEPTH_TOTAL[preset]) } })
    }
  }

  function setStageCount(stage: (typeof TOPIC_STAGES)[number], value: number): void {
    const count = Math.max(0, Math.min(MAX_PER_STAGE, Math.round(value) || 0))
    patch({
      questionDepth: { preset: 'custom', perStage: { ...questionsDepth.perStage, [stage]: count } }
    })
  }

  function onPrimary(): void {
    if (problem) {
      setShowProblem(true)
      return
    }
    if (keywordsOnly) {
      void primary.advance('keywords')
      return
    }
    if (hasProfile) {
      void primary.advance('profile')
      return
    }
    void primary.advance('profile', (draftId) =>
      client['topics:writeProfile']({ projectId: project.id, draftId })
    )
  }

  const note = primary.error
    ? primary.error
    : showProblem && problem
      ? problem
      : keywordsOnly
        ? 'Next: core terms and keyword groups'
        : hasProfile
          ? 'Next: the buyer profile you saved'
          : 'Next: CiteFox AI writes a buyer profile · about 20 s'
  const total = questionTarget(questionsDepth)
  const marketLabels = project.markets.filter((market) => draft.marketIds.includes(market.id))

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Start from a problem"
      aside="Nothing is checked yet. You can change everything later."
      footer={{
        onBack: props.back,
        note,
        noteTone: primary.error || (showProblem && problem) ? 'warn' : 'neutral',
        primary: {
          label: keywordsOnly
            ? 'Find keywords'
            : hasProfile
              ? 'Next: buyer profile'
              : 'Write buyer profile',
          onClick: onPrimary,
          busy: primary.busy
        }
      }}
    >
      <div className="tw-grid">
        <div className="tw-main">
          <Panel label="Your seed">
            <div className="tw-row tw-row-seed">
              <div className="tw-field tw-grow">
                <label className="tw-label" htmlFor={ids.seed}>
                  Problem or seed
                </label>
                <input
                  id={ids.seed}
                  className="ui-input tw-input-lg"
                  value={draft.seed}
                  aria-describedby={ids.help}
                  aria-invalid={showProblem && draft.seed.trim().length < 3 ? true : undefined}
                  onChange={(event) => setSeed(event.target.value)}
                />
              </div>
              <div className="tw-field tw-name">
                <label className="tw-label" htmlFor={ids.name}>
                  Topic name
                </label>
                <input
                  id={ids.name}
                  className="ui-input tw-input-lg"
                  value={draft.name}
                  onChange={(event) => {
                    nameTouched.current = true
                    patch({ name: event.target.value })
                  }}
                />
              </div>
            </div>
            <p className="tw-help" id={ids.help}>
              Write it the way your buyer would say it. One line is enough.
            </p>
            {draft.otherSeeds.length > 0 ? (
              <div className="tw-inline-chips">
                <span className="tw-help">Other seeds</span>
                {draft.otherSeeds.map((seed) => (
                  <Button key={seed} size="sm" onClick={() => setSeed(seed)}>
                    {seed}
                  </Button>
                ))}
              </div>
            ) : null}
          </Panel>
          <div className="tw-pair">
            <Panel
              title="Your business"
              actions={
                <AiMenu
                  label="AI actions for your business"
                  actions={[
                    {
                      id: 'discover',
                      label: 'Discover from website',
                      seconds: 25,
                      onSelect: discover
                    },
                    { id: 'seeds', label: 'Suggest seeds', seconds: 10, onSelect: discover }
                  ]}
                />
              }
            >
              <div className="tw-field">
                <label className="tw-label" htmlFor={ids.site}>
                  Website
                </label>
                <input
                  id={ids.site}
                  className="ui-input mono"
                  value={draft.website}
                  onChange={(event) => patch({ website: event.target.value })}
                />
              </div>
              <div className="tw-field">
                <label className="tw-label" htmlFor={ids.about}>
                  About the business <span className="tw-muted">(optional)</span>
                </label>
                <textarea
                  id={ids.about}
                  className="ui-input tw-textarea"
                  rows={3}
                  value={draft.about}
                  onChange={(event) => patch({ about: event.target.value })}
                />
              </div>
            </Panel>
            <Panel title="What to generate">
              <div className="tw-field">
                <span className="tw-label" aria-hidden="true">
                  Generate
                </span>
                <SegmentedControl
                  label="Generate"
                  options={GENERATE_OPTIONS}
                  value={draft.generate}
                  onChange={(generate) => patch({ generate })}
                />
              </div>
              {keywordsOnly ? null : (
                <div className="tw-field">
                  <span className="tw-label" aria-hidden="true">
                    How many buyer questions
                  </span>
                  <SegmentedControl
                    label="How many buyer questions"
                    options={DEPTH_OPTIONS}
                    value={questionsDepth.preset}
                    onChange={setDepth}
                  />
                  <p className="tw-help num">{QUESTION_DEPTH_LINE[questionsDepth.preset]}</p>
                  {questionsDepth.preset === 'custom' ? (
                    <div className="tw-per-stage">
                      {TOPIC_STAGES.map((stage) => (
                        <label key={stage} className="tw-per-stage-item">
                          <span>{TOPIC_STAGE_LABEL[stage]}</span>
                          <input
                            type="number"
                            min={0}
                            max={MAX_PER_STAGE}
                            className="ui-input ui-input-sm num"
                            value={questionsDepth.perStage[stage]}
                            onChange={(event) => setStageCount(stage, Number(event.target.value))}
                          />
                        </label>
                      ))}
                      <p className={total > MAX_TOPIC_QUESTIONS ? 'tw-help tw-warn' : 'tw-help'}>
                        {total} of at most {MAX_TOPIC_QUESTIONS} questions
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
              {draft.generate !== 'questions' ? (
                <p className="tw-help tw-info">Keywords are scored apart, with their own goal.</p>
              ) : null}
            </Panel>
          </div>
          <Panel label="Brand and markets" padding={20}>
            <div className="tw-brand-row">
              <h2 className="tw-brand-title">Brand and markets</h2>
              <dl className="tw-brand-facts">
                <div>
                  <dt>Brand</dt>
                  <dd>
                    {draft.brandNames[0] ?? project.name}
                    {draft.brandNames.length > 1 ? ` +${draft.brandNames.length - 1} aliases` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Competitors</dt>
                  <dd className="num">{draft.competitors.length} from settings</dd>
                </div>
                <TopicProductFact projectId={project.id} draft={draft} />
                <div>
                  <dt>Markets</dt>
                  <dd>{marketLabels.map((market) => market.label).join(', ') || 'None picked'}</dd>
                </div>
              </dl>
              <Button
                variant="ghost"
                iconEnd={brandOpen ? 'chevron-up' : 'chevron-down'}
                aria-expanded={brandOpen}
                onClick={() => setBrandOpen((open) => !open)}
              >
                {brandOpen ? 'Done' : 'Edit'}
              </Button>
            </div>
            {brandOpen ? (
              <div className="tw-brand-edit">
                <div>
                  <p className="tw-label">Brand and aliases</p>
                  <p>{draft.brandNames.join(' · ') || 'None'}</p>
                </div>
                <div>
                  <p className="tw-label">Competitors</p>
                  <p>{draft.competitors.join(' · ') || 'None'}</p>
                  <p className="tw-help">
                    Change these in <a href="#/project-settings">Project settings</a>.
                  </p>
                </div>
                <fieldset className="tw-fieldset">
                  <legend className="tw-label">Markets</legend>
                  <div className="tw-checks">
                    {project.markets.map((market) => {
                      const on = draft.marketIds.includes(market.id)
                      return (
                        <label key={market.id} className="tw-check">
                          <input
                            type="checkbox"
                            className="ui-check"
                            checked={on}
                            onChange={() =>
                              patch({
                                marketIds: on
                                  ? draft.marketIds.filter((id) => id !== market.id)
                                  : [...draft.marketIds, market.id]
                              })
                            }
                          />
                          {market.label}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <TopicProductPicker projectId={project.id} draft={draft} patch={patch} />
              </div>
            ) : null}
          </Panel>
        </div>
        <aside className="tw-rail" aria-label="Suggestions from your site">
          {discovery.phase === 'idle' ? (
            <Panel title={`From ${draft.website || project.domain}`} tone="inset">
              <p className="tw-muted">
                CiteFox AI can read your homepage and key pages and suggest problems, segments and
                competitors.
              </p>
              <div className="tw-rail-foot">
                <Button size="sm" icon="sparkle" onClick={discover}>
                  Discover from website
                </Button>
                <span className="tw-note">25 s · no searches</span>
              </div>
            </Panel>
          ) : (
            <DiscoveryCard
              state={discovery}
              website={draft.website || project.domain}
              segments={draft.segments}
              onUseSeed={(seed) => {
                seedBefore.current = {
                  seed: draft.seed,
                  name: draft.name,
                  productId: draft.productId
                }
                setSeed(seed.text)
                // The seed is about one product: every later step reads its competitors.
                if (seed.productId !== null)
                  patch({ product: { mode: 'pick', productId: seed.productId } })
                if (discovery.result?.about && !draft.about.trim())
                  patch({ about: discovery.result.about })
              }}
              onToggleSegment={(segment) =>
                patch({
                  segments: draft.segments.includes(segment)
                    ? draft.segments.filter((item) => item !== segment)
                    : [...draft.segments, segment]
                })
              }
              onUndo={() => {
                const before = seedBefore.current
                if (before)
                  patch({
                    seed: before.seed,
                    name: before.name,
                    product:
                      before.productId === undefined
                        ? { mode: 'auto' }
                        : { mode: 'pick', productId: before.productId }
                  })
              }}
              onUseSwitchingFrom={(names) =>
                patch({ switchingFrom: mergeNames(draft.switchingFrom, names) })
              }
              onNoteIntegrations={(names) =>
                patch({ integrations: mergeNames(draft.integrations, names) })
              }
            />
          )}
        </aside>
      </div>
    </StepFrame>
  )
}

/** Adds names not already there, case-insensitively, up to 12 (Docs/FEEDBACK.md row 3). */
function mergeNames(current: readonly string[] | undefined, names: readonly string[]): string[] {
  const out = [...(current ?? [])]
  for (const name of names) {
    if (!out.some((item) => item.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out.slice(0, 12)
}
