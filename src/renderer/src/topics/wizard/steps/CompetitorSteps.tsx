import { useId, useMemo, useRef, useState, type JSX } from 'react'
import {
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL,
  type CompetitorPageRead,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import type { TopicPromptSuggestions } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { formatMoment } from '../../../utils/dates'
import {
  AiMenu,
  Button,
  Chip,
  ListGrid,
  Panel,
  UiIcon,
  UrlText,
  type ListColumn,
  type MenuItem
} from '../../../ui'
import { AiCard } from '../components/AiCard'
import { LineEditor } from '../components/LineEditor'
import { STAGE_CHOICES, inCheckColumn, stageGroup, textColumn } from '../components/questionColumns'
import { StageMenuButton } from '../components/questionGrid'
import { StepFrame } from '../components/StepFrame'
import { useAiRun } from '../hooks/useAiRun'
import { included, isPageUrl, pick, questionsOf, stageCounts, stepProblem } from '../utils/draft'
import { promptInput } from '../utils/patch'
import { restorePrompts, usePrimary, type StepProps } from './shared'

const ASIDE = 'Nothing is sent to them. Both brands are left out of the questions.'

/** "Read Oct 19, 3:12 PM": the computer's own zone and clock (formatMoment). */
function readLabel(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return ''
  return `Read ${formatMoment(iso)}`
}

/** "Their page" rail panel: title, H1, headings and FAQs, the outline on demand. */
function TheirPagePanel({ page }: { page: CompetitorPageRead }): JSX.Element {
  const [open, setOpen] = useState(false)
  const outlineId = useId()
  return (
    <Panel
      title="Their page"
      actions={<span className="tw-help num">{readLabel(page.readAt)}</span>}
    >
      <p className="tw-strong">{page.title ?? page.url}</p>
      {page.h1 ? <p className="tw-help">H1: {page.h1}</p> : null}
      <p className="tw-help num">
        {page.outline.length} headings · {page.faqCount} FAQs
      </p>
      <Button
        variant="ghost"
        size="sm"
        icon={open ? 'chevron-down' : 'chevron-right'}
        aria-expanded={open}
        aria-controls={outlineId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide outline' : 'Show outline'}
      </Button>
      {open ? (
        <ol className="tw-outline" id={outlineId}>
          {page.outline.map((heading) => (
            <li key={heading}>{heading}</li>
          ))}
        </ol>
      ) : null}
    </Panel>
  )
}

function useRead(props: StepProps): {
  reading: boolean
  error: string | null
  read: (url: string) => Promise<void>
} {
  const { draft, project, client, flush, replace, patch } = props
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function read(url: string): Promise<void> {
    const value = url.trim()
    if (!isPageUrl(value)) {
      setError('Enter their page address, starting with https://.')
      return
    }
    setReading(true)
    setError(null)
    try {
      patch({ competitorUrl: value })
      const saved = (await flush()) ?? draft
      const result = await client['topics:readCompetitorPage']({
        projectId: project.id,
        draftId: saved.id,
        url: value
      })
      replace(result.draft)
      if (!result.page.ok) setError(result.page.message ?? 'Could not read their page.')
    } catch (cause) {
      setError(errorText(cause, 'Could not read their page.'))
    } finally {
      setReading(false)
    }
  }
  return { reading, error, read }
}

/** Competitor page, step 1: their URL, read once (no search), then questions from it. */
export function TheirPageStep(props: StepProps): JSX.Element {
  const { draft, project, client } = props
  const primary = usePrimary(props)
  const { reading, error, read } = useRead(props)
  const [url, setUrl] = useState(draft.competitorUrl ?? '')
  const [marketId, setMarketId] = useState(draft.marketIds[0] ?? project.markets[0]?.id ?? '')
  const ids = { url: useId(), market: useId() }
  const page = draft.competitorPage
  const problem = stepProblem(draft, 'competitor')
  const hasQuestions = questionsOf(draft).some((q) => q.source === 'competitor')

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Track a competitor's page"
      headerEnd={<p className="tw-help">{ASIDE}</p>}
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          error ??
          problem ??
          'Next: CiteFox AI writes questions from their page · about 25 s',
        noteTone: primary.error || error || problem ? 'warn' : 'neutral',
        primary: {
          label: hasQuestions ? 'Next: questions' : 'Questions from their page',
          busy: primary.busy,
          disabled: Boolean(problem),
          onClick: () => {
            props.patch({ marketIds: marketId ? [marketId] : draft.marketIds })
            void primary.advance(
              'questions',
              hasQuestions
                ? undefined
                : async (draftId) =>
                    (
                      await client['topics:competitorQuestions']({
                        projectId: project.id,
                        draftId,
                        marketId: marketId || null
                      })
                    ).draft
            )
          }
        }
      }}
    >
      <div className="tw-grid">
        <div className="tw-main">
          <Panel label="Their page address">
            <div className="tw-url-bar">
              <label className="tw-field tw-grow" htmlFor={ids.url}>
                <span className="tw-label">Their page URL</span>
                <input
                  id={ids.url}
                  className="ui-input mono"
                  type="url"
                  placeholder="https://www.example.com/their-page/"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void read(url)
                  }}
                />
              </label>
              <Button busy={reading} onClick={() => void read(url)}>
                {page?.ok && page.url === url.trim() ? 'Read again' : 'Read their page'}
              </Button>
            </div>
            <p className="tw-help">One read, no searches. CiteFox sends them nothing.</p>
            <label className="tw-field tw-narrow" htmlFor={ids.market}>
              <span className="tw-label">Market</span>
              <select
                id={ids.market}
                className="ui-input tw-select"
                value={marketId}
                onChange={(event) => setMarketId(event.target.value)}
              >
                {project.markets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {market.label}
                  </option>
                ))}
              </select>
            </label>
          </Panel>
          <Panel title="What happens next" tone="inset">
            <ol className="tw-steps-list">
              <li>CiteFox reads their page once: title, description, H1 and outline.</li>
              <li>
                CiteFox AI writes buyer questions their page answers, with both brands left out.
              </li>
              <li>You match the questions to your own pages, then check.</li>
              <li>After a check: the questions where they&apos;re cited and you&apos;re not.</li>
            </ol>
          </Panel>
        </div>
        <aside className="tw-rail" aria-label="Their page">
          {page?.ok ? <TheirPagePanel page={page} /> : null}
        </aside>
      </div>
    </StepFrame>
  )
}

/** Competitor page, step 2 (Competitor-Page.png): questions from their page, claims, preview. */
export function CompetitorQuestionsStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush } = props
  const primary = usePrimary(props)
  const { reading, error: readError, read } = useRead(props)
  const ai = useAiRun<TopicPromptSuggestions>()
  const [editing, setEditing] = useState<TopicDraftPrompt | null>(null)
  const [section, setSection] = useState<TopicDraftPrompt | null>(null)
  const [allClaims, setAllClaims] = useState(false)
  const before = useRef<TopicDraft | null>(null)
  const page = draft.competitorPage
  const questions = questionsOf(draft)
  const kept = included(questions)
  const counts = stageCounts(questions)
  const markets = project.markets.filter((market) => draft.marketIds.includes(market.id))
  const claims = draft.competitorClaims.filter((claim) => claim.onYourSite !== 'yes')

  async function draftId(): Promise<string> {
    return ((await flush()) ?? draft).id
  }

  function discover(): void {
    const stage = TOPIC_STAGES.reduce<TopicStage>(
      (low, s) => (counts[s].included < counts[low].included ? s : low),
      'problem'
    )
    ai.run({
      id: 'discover',
      title: `Discover more questions: ${TOPIC_STAGE_LABEL[stage]}`,
      seconds: 15,
      call: async () =>
        client['topics:discoverStageQuestions']({
          projectId: project.id,
          draftId: await draftId(),
          stage
        })
    })
  }

  function rewrite(ids: readonly string[]): void {
    ai.run({
      id: 'rewrite',
      title: 'Rewrite selected',
      seconds: 20,
      call: async (instruction) =>
        client['topics:rewriteQuestion']({
          projectId: project.id,
          draftId: await draftId(),
          promptIds: ids.length ? ids : kept.map((q) => q.id),
          instruction
        })
    })
  }

  function apply(ids: readonly string[]): void {
    const answer = ai.result
    if (!answer) return
    before.current = draft
    const picked = answer.suggestions.filter((item) => ids.includes(item.id))
    patch({
      upsertPrompts: picked.map((item) => {
        const row = item.replacesId ? questions.find((q) => q.id === item.replacesId) : undefined
        return row
          ? promptInput(row, { text: item.text })
          : { kind: 'question', text: item.text, stage: item.stage, source: 'claude' }
      })
    })
  }

  function undo(): void {
    const snapshot = before.current
    if (!snapshot) return
    void flush().then((saved) => {
      const restore = restorePrompts(snapshot, saved ?? draft)
      if (restore.removePromptIds || restore.upsertPrompts) patch(restore)
    })
  }

  function setIncluded(ids: readonly string[], value: boolean): void {
    patch({
      upsertPrompts: pick(questions, ids).map((row) => promptInput(row, { included: value }))
    })
  }

  const columns = useMemo<ListColumn<TopicDraftPrompt>[]>(
    () => [
      textColumn(),
      {
        id: 'from',
        label: 'From their section',
        width: 200,
        sort: (row) => row.sourceNote ?? '',
        render: (row) => <span className="tw-clamp tw-muted">{row.sourceNote ?? '—'}</span>
      },
      inCheckColumn()
    ],
    []
  )

  function rowMenu(row: TopicDraftPrompt): MenuItem[] {
    return [
      { id: 'edit', label: 'Edit wording', icon: 'pencil', onSelect: () => setEditing(row) },
      {
        id: 'move',
        label: 'Move to another stage',
        icon: 'layers',
        onSelect: () => setEditing(row)
      },
      {
        id: 'section',
        label: 'Show their section',
        icon: 'eye',
        disabled: !row.sourceNote,
        onSelect: () => setSection(row)
      },
      {
        id: 'toggle',
        label: row.included ? 'Leave out of the check' : 'Include in the check',
        icon: row.included ? 'x' : 'check',
        onSelect: () => setIncluded([row.id], !row.included)
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => patch({ removePromptIds: [row.id] })
      }
    ]
  }

  const problem = stepProblem(draft, 'questions')
  const answer = ai.result
  const shownClaims = allClaims ? claims : claims.slice(0, 2)

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Track a competitor's page"
      headerEnd={<p className="tw-help">{ASIDE}</p>}
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          readError ??
          problem ??
          `${kept.length} of ${questions.length} included · ${markets.map((m) => m.label).join(', ') || 'no market'}`,
        noteTone: primary.error || readError || problem ? 'warn' : 'neutral',
        primary: {
          label: 'Match my pages',
          busy: primary.busy,
          disabled: Boolean(problem),
          onClick: () =>
            void primary.advance(
              'pages',
              async (id) =>
                (await client['topics:matchPages']({ projectId: project.id, draftId: id })).draft
            )
        }
      }}
    >
      <div className="tw-grid">
        <div className="tw-main">
          <Panel label="Their page address" padding={16}>
            <div className="tw-url-bar">
              <span className="ui-input tw-url-read">
                {draft.competitorUrl ? <UrlText url={draft.competitorUrl} /> : null}
              </span>
              {page?.ok ? (
                <Chip tone="ok">
                  <UiIcon name="check" size={12} /> Read · {page.wordCount.toLocaleString('en-US')}{' '}
                  words
                </Chip>
              ) : null}
              <AiMenu
                label="AI actions for their page"
                actions={[
                  {
                    id: 'reread',
                    label: reading ? 'Reading…' : 'Read the page again',
                    seconds: 6,
                    icon: 'refresh',
                    disabled: reading,
                    onSelect: () => void read(draft.competitorUrl ?? '')
                  },
                  {
                    id: 'claims',
                    label: 'Compare claims with mine',
                    seconds: 15,
                    icon: 'eye',
                    onSelect: () => setAllClaims(true)
                  }
                ]}
              />
            </div>
          </Panel>
          {section ? (
            <div className="tw-line" role="status">
              <p>
                <strong>Their section:</strong> {section.sourceNote}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setSection(null)}>
                Close
              </Button>
            </div>
          ) : null}
          {editing ? (
            <LineEditor
              title="Edit question"
              label="Question"
              initialText={editing.text}
              choiceLabel="Stage"
              choices={STAGE_CHOICES}
              initialChoice={editing.stage ?? 'problem'}
              onCancel={() => setEditing(null)}
              onSave={(text, choice) => {
                patch({
                  upsertPrompts: [
                    promptInput(editing, { text, stage: (choice ?? 'problem') as TopicStage })
                  ]
                })
                setEditing(null)
              }}
            />
          ) : null}
          {ai.phase !== 'idle' ? (
            <AiCard
              state={ai}
              info={answer?.info ?? null}
              items={answer?.suggestions.map((item) => ({
                id: item.id,
                label: item.stage ? TOPIC_STAGE_LABEL[item.stage] : undefined,
                text: item.text,
                detail: item.reason
              }))}
              {...(answer && answer.suggestions.length > 0 ? { onApply: apply, onUndo: undo } : {})}
            />
          ) : null}
          <ListGrid
            label="Questions from their page"
            noun={['question', 'questions']}
            rows={questions}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.text}
            columns={columns}
            search={{ text: (row) => `${row.text} ${row.sourceNote ?? ''}` }}
            ai={
              <AiMenu
                label="AI actions for questions"
                actions={[
                  {
                    id: 'discover',
                    label: 'Discover more questions',
                    seconds: 15,
                    icon: 'compass',
                    onSelect: discover
                  },
                  {
                    id: 'rewrite',
                    label: 'Rewrite like a buyer',
                    seconds: 20,
                    icon: 'wand',
                    onSelect: () => rewrite([])
                  }
                ]}
              />
            }
            group={stageGroup((groupRows) => {
              const out = groupRows.filter((row) => !row.included).length
              return out > 0 ? `${out} left out` : null
            })}
            bulk={({ selected, clear }) => {
              const ids = selected.map((row) => row.id)
              return (
                <>
                  <Button
                    size="sm"
                    icon="x"
                    onClick={() => {
                      setIncluded(ids, false)
                      clear()
                    }}
                  >
                    Leave out
                  </Button>
                  <StageMenuButton
                    onPick={(stage) => {
                      patch({
                        upsertPrompts: pick(questions, ids).map((row) =>
                          promptInput(row, { stage })
                        )
                      })
                      clear()
                    }}
                  />
                  <Button
                    size="sm"
                    icon="sparkle"
                    onClick={() => {
                      rewrite(ids)
                      clear()
                    }}
                  >
                    Rewrite
                  </Button>
                  <Button
                    size="sm"
                    icon="trash"
                    onClick={() => {
                      patch({ removePromptIds: ids })
                      clear()
                    }}
                  >
                    Remove
                  </Button>
                </>
              )
            }}
            rowMenu={rowMenu}
            summary={() =>
              `${kept.length} of ${questions.length} included · ${TOPIC_STAGES.filter((s) => counts[s].total > 0).length} stages`
            }
            empty={<p className="tw-muted">No questions yet. Go back and read their page.</p>}
            maxBodyHeight={420}
          />
        </div>
        <aside className="tw-rail" aria-label="Their page and claims">
          {page?.ok ? <TheirPagePanel page={page} /> : null}
          {claims.length > 0 ? (
            <Panel
              className="tw-claims"
              title={
                <span className="tw-suggest-head">
                  <span className="ui-suggest-mark" aria-hidden="true">
                    <UiIcon name="sparkle" size={14} />
                  </span>
                  {claims.length}{' '}
                  {claims.length === 1 ? "claim you don't make" : "claims you don't make"}
                </span>
              }
            >
              <ul className="tw-claim-list">
                {shownClaims.map((claim) => (
                  <li key={claim.id}>
                    <span>{claim.claim}</span>
                    <Chip size="sm" tone={claim.onYourSite === 'no' ? 'bad' : 'warn'}>
                      {claim.onYourSite === 'no' ? 'Not on site' : 'Partly'}
                    </Chip>
                  </li>
                ))}
              </ul>
              <div className="tw-rail-foot">
                {claims.length > 2 ? (
                  <Button size="sm" onClick={() => setAllClaims((value) => !value)}>
                    {allClaims ? 'Show fewer' : `Show all ${claims.length}`}
                  </Button>
                ) : null}
                <span className="tw-note">Sample read · verify first</span>
              </div>
            </Panel>
          ) : null}
          <Panel padding={20} label="Cited for them, not you">
            <div className="tw-preview">
              <span className="tw-preview-n num" aria-hidden="true">
                —
              </span>
              <span>
                <span className="tw-strong">Cited for them, not you</span>
                <span className="tw-help">Shows after the first check</span>
              </span>
            </div>
          </Panel>
        </aside>
      </div>
    </StepFrame>
  )
}
