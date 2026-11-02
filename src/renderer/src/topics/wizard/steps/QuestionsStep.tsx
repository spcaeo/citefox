import { useRef, useState, type JSX } from 'react'
import {
  QUESTION_DEPTH_TOTAL,
  TOPIC_STAGES,
  TOPIC_STAGE_HINT,
  TOPIC_STAGE_LABEL,
  type DepthPreset,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import type { JourneyGapsResult, TopicDraftPatch, TopicPromptSuggestions } from '@shared/ipc'
import {
  AiMenu,
  AssistProgress,
  Button,
  IconButton,
  ListGrid,
  SegmentedControl,
  Tabs,
  UiIcon,
  useAssistProgress,
  type MenuItem
} from '../../../ui'
import { AiCard } from '../components/AiCard'
import { LineEditor } from '../components/LineEditor'
import {
  STAGE_CHOICES,
  inCheckColumn,
  numberColumn,
  questionNumbers,
  rivalNames,
  stageGroup,
  textColumn
} from '../components/questionColumns'
import { QuestionFlags, StageMenuButton } from '../components/questionGrid'
import { StepFrame } from '../components/StepFrame'
import { aiProgress, READS_SAVED, useAiRun } from '../hooks/useAiRun'
import { included, perStageFor, pick, questionsOf, stageCounts, stepProblem } from '../utils/draft'
import { rangeText, searchRange } from '../utils/estimate'
import { promptInput } from '../utils/patch'
import { namesAny } from '../utils/text'
import { generateKeywords, restorePrompts, usePrimary, type StepProps } from './shared'

type Editing = { mode: 'add' } | { mode: 'edit'; prompt: TopicDraftPrompt } | null
type StageTab = 'all' | TopicStage

const DEPTHS: readonly { value: Exclude<DepthPreset, 'custom'>; label: string }[] = [
  { value: 'quick', label: 'Quick 15' },
  { value: 'standard', label: 'Standard 30' },
  { value: 'deep', label: 'Deep 60' }
]

/** Buyer journey questions (Seed-Questions.png): by stage, edit, add, AI discover and rewrite. */
export function QuestionsStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush, replace } = props
  const primary = usePrimary(props)
  const ai = useAiRun<TopicPromptSuggestions>()
  const gaps = useAiRun<JourneyGapsResult>()
  const [tab, setTab] = useState<StageTab>('all')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<Editing>(null)
  const [depthAsk, setDepthAsk] = useState<Exclude<DepthPreset, 'custom'> | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const regenProgress = useAssistProgress(regenerating, 'topics:')
  const beforeApply = useRef<TopicDraft | null>(null)

  const questions = questionsOf(draft)
  const numbers = questionNumbers(questions)
  const rivals = rivalNames(draft.competitors)
  const counts = stageCounts(questions)
  const kept = included(questions)
  const rows = questions.filter((question) => {
    if (tab !== 'all' && question.stage !== tab) return false
    if (filter === 'in') return question.included
    if (filter === 'flag')
      return (
        question.flags.length > 0 ||
        question.overlapWith.length > 0 ||
        namesAny(question.text, rivals)
      )
    return true
  })

  async function draftId(): Promise<string> {
    return ((await flush()) ?? draft).id
  }

  function discover(): void {
    const stage =
      tab !== 'all'
        ? tab
        : (TOPIC_STAGES.reduce<TopicStage>(
            (low, stage) => (counts[stage].included < counts[low].included ? stage : low),
            'problem'
          ) as TopicStage)
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
    const targets = ids.length > 0 ? ids : kept.map((question) => question.id)
    ai.run({
      id: 'rewrite',
      title: 'Rewrite like a buyer',
      seconds: ids.length === 1 ? 5 : 40,
      call: async (instruction) =>
        client['topics:rewriteQuestion']({
          projectId: project.id,
          draftId: await draftId(),
          promptIds: targets,
          instruction
        })
    })
  }

  function findGaps(): void {
    gaps.run({
      id: 'gaps',
      title: 'Journey gaps',
      seconds: 12,
      call: async () =>
        client['topics:findJourneyGaps']({ projectId: project.id, draftId: await draftId() })
    })
  }

  function remember(): void {
    beforeApply.current = draft
  }

  function applySuggestions(
    ids: readonly string[],
    list: TopicPromptSuggestions['suggestions']
  ): void {
    remember()
    const picked = list.filter((item) => ids.includes(item.id))
    const upsertPrompts = picked.map((item) => {
      const existing = item.replacesId ? questions.find((q) => q.id === item.replacesId) : undefined
      return existing
        ? promptInput(existing, { text: item.text, ...(item.stage ? { stage: item.stage } : {}) })
        : {
            kind: 'question' as const,
            text: item.text,
            stage: item.stage,
            source: 'claude' as const
          }
    })
    patch({ upsertPrompts })
  }

  function undo(): void {
    const before = beforeApply.current
    if (!before) return
    void flush().then((saved) => {
      const restore = restorePrompts(before, saved ?? draft)
      if (restore.removePromptIds || restore.upsertPrompts) patch(restore)
    })
  }

  function leaveOutOverlaps(): void {
    const result = gaps.result
    if (!result) return
    remember()
    const upsertPrompts = pick(
      questions,
      result.overlaps.map((pair) => pair.b)
    ).map((question) => promptInput(question, { included: false }))
    if (upsertPrompts.length > 0) patch({ upsertPrompts })
  }

  function setIncluded(ids: readonly string[], value: boolean): void {
    const upsertPrompts = pick(questions, ids).map((question) =>
      promptInput(question, { included: value })
    )
    patch({ upsertPrompts })
  }

  function moveTo(ids: readonly string[], stage: TopicStage): void {
    patch({
      upsertPrompts: pick(questions, ids).map((question) => promptInput(question, { stage }))
    })
  }

  async function regenerate(preset: Exclude<DepthPreset, 'custom'>): Promise<void> {
    setDepthAsk(null)
    setRegenerating(true)
    try {
      patch({ questionDepth: { preset, perStage: perStageFor(QUESTION_DEPTH_TOTAL[preset]) } })
      const id = await draftId()
      replace(
        await client['topics:generateQuestions']({
          projectId: project.id,
          draftId: id,
          replace: true
        })
      )
    } catch (cause) {
      primary.setError(
        cause instanceof Error ? cause.message : 'CiteFox AI could not write the questions.'
      )
    } finally {
      setRegenerating(false)
    }
  }

  function rowMenu(row: TopicDraftPrompt): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'edit',
        label: 'Edit wording',
        icon: 'pencil',
        onSelect: () => setEditing({ mode: 'edit', prompt: row })
      },
      {
        id: 'rewrite',
        label: 'Rewrite like a buyer',
        hint: '5 s',
        tone: 'ai',
        icon: 'sparkle',
        onSelect: () => rewrite([row.id])
      }
    ]
    if (row.overlapWith.length > 0) {
      items.push({
        id: 'overlap',
        label: 'See the overlap',
        icon: 'merge',
        onSelect: () => {
          setTab('all')
          setFilter('flag')
        }
      })
    }
    items.push(
      {
        id: 'move',
        label: 'Move to another stage',
        icon: 'layers',
        onSelect: () => setEditing({ mode: 'edit', prompt: row })
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
    )
    return items
  }

  const columns = [
    numberColumn(numbers),
    textColumn(),
    inCheckColumn(),
    {
      id: 'flags',
      label: 'Flags',
      width: 180,
      render: (row: TopicDraftPrompt) => (
        <QuestionFlags prompt={row} numbers={numbers} rivals={rivals} />
      )
    }
  ]

  const range = searchRange(kept.length, draft.marketIds.length)
  const problem = stepProblem(draft, 'questions')
  const toKeywords = draft.generate === 'both'
  const hasKeywords = draft.prompts.some((prompt) => prompt.kind === 'keyword')
  const answer = ai.result
  const gapResult = gaps.result
  const flagged = questions.filter(
    (question) =>
      question.flags.length > 0 ||
      question.overlapWith.length > 0 ||
      namesAny(question.text, rivals)
  ).length
  const depthPreset =
    draft.depth.questions.preset === 'custom' ? null : draft.depth.questions.preset

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Buyer journey questions"
      headerEnd={
        <div className="tw-depth">
          <span className="tw-help">Depth</span>
          <SegmentedControl
            label="Question depth"
            options={DEPTHS}
            value={depthPreset ?? 'standard'}
            onChange={(value) => (value === depthPreset ? undefined : setDepthAsk(value))}
          />
        </div>
      }
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          problem ??
          `${kept.length} of ${questions.length} included · about ${rangeText(range.low, range.high)} searches per check`,
        noteTone: primary.error || problem ? 'warn' : 'neutral',
        primary: {
          label: toKeywords ? 'Next: keywords' : 'Match pages',
          busy: primary.busy,
          disabled: Boolean(problem),
          onClick: () => {
            if (toKeywords) {
              void primary.advance(
                'keywords',
                hasKeywords
                  ? undefined
                  : async (id) => (await generateKeywords(client, project.id, id)).draft
              )
            } else {
              void primary.advance(
                'pages',
                async (id) =>
                  (await client['topics:matchPages']({ projectId: project.id, draftId: id })).draft
              )
            }
          }
        }
      }}
    >
      {depthAsk ? (
        <div className="tw-line" role="group" aria-label="Change depth">
          <UiIcon name="sparkle" size={14} />
          <p>
            Write questions again for {DEPTHS.find((d) => d.value === depthAsk)?.label}? Questions
            you added or edited by hand stay.
          </p>
          <Button size="sm" onClick={() => void regenerate(depthAsk)}>
            Write again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDepthAsk(null)}>
            Keep these
          </Button>
        </div>
      ) : null}
      {regenerating ? (
        <AssistProgress
          progress={regenProgress}
          title="Writing questions again"
          reads={READS_SAVED}
          expectedSeconds={40}
        />
      ) : null}
      {gaps.phase !== 'idle' ? (
        <div className="tw-line tw-line-ai" role="group" aria-label="Journey gaps">
          <span className="ui-suggest-mark" aria-hidden="true">
            <UiIcon name="sparkle" size={14} />
          </span>
          <p role="status">
            {gaps.phase === 'running'
              ? aiProgress(12, READS_SAVED)
              : gaps.phase === 'error'
                ? gaps.error
                : gapResult?.headline}
          </p>
          {gapResult && gaps.phase === 'ready' ? (
            <>
              {gapResult.suggestions.length > 0 ? (
                <Button
                  size="sm"
                  onClick={() =>
                    applySuggestions(
                      gapResult.suggestions.map((s) => s.id),
                      gapResult.suggestions
                    )
                  }
                >
                  Fill the gaps
                </Button>
              ) : null}
              {gapResult.overlaps.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={leaveOutOverlaps}>
                  Leave out overlaps
                </Button>
              ) : null}
            </>
          ) : null}
          <IconButton icon="x" size="sm" label="Dismiss journey gaps" onClick={gaps.close} />
        </div>
      ) : null}
      <Tabs<StageTab>
        label="Journey stages"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All', count: questions.length },
          ...TOPIC_STAGES.map((stage) => ({
            id: stage,
            label: TOPIC_STAGE_LABEL[stage],
            count: counts[stage].total
          }))
        ]}
      />
      {editing ? (
        <LineEditor
          title={editing.mode === 'add' ? 'Add a question' : 'Edit question'}
          label="Question, in the buyer's words"
          initialText={editing.mode === 'edit' ? editing.prompt.text : ''}
          choiceLabel="Stage"
          choices={STAGE_CHOICES}
          initialChoice={
            editing.mode === 'edit'
              ? (editing.prompt.stage ?? 'problem')
              : tab === 'all'
                ? 'problem'
                : tab
          }
          hint="Long and situational works best. Never your brand name."
          validate={(text) =>
            namesAny(text, draft.brandNames)
              ? 'Leave your brand name out of buyer questions.'
              : null
          }
          onCancel={() => setEditing(null)}
          onSave={(text, choice) => {
            const stage = (choice ?? 'problem') as TopicStage
            const change: TopicDraftPatch =
              editing.mode === 'edit'
                ? { upsertPrompts: [promptInput(editing.prompt, { text, stage })] }
                : { upsertPrompts: [{ kind: 'question', text, stage, source: 'user' }] }
            patch(change)
            setEditing(null)
          }}
        />
      ) : null}
      {ai.phase !== 'idle' ? (
        <AiCard
          state={ai}
          info={answer?.info ?? null}
          meta={
            answer && answer.droppedForBrand > 0
              ? `${answer.droppedForBrand} left out for naming your brand`
              : undefined
          }
          items={answer?.suggestions.map((item) => ({
            id: item.id,
            label: item.stage ? TOPIC_STAGE_LABEL[item.stage] : undefined,
            text: item.text,
            detail: item.replacesId
              ? `Replaces Q${numbers.get(item.replacesId) ?? ''}`
              : item.reason
          }))}
          {...(answer && answer.suggestions.length > 0
            ? {
                onApply: (ids: string[]) => applySuggestions(ids, answer.suggestions),
                onUndo: undo
              }
            : {})}
        />
      ) : null}
      <ListGrid
        label="Buyer questions"
        noun={['question', 'questions']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => `Q${numbers.get(row.id) ?? ''}`}
        columns={columns}
        search={{ text: (row) => row.text }}
        filter={{
          label: 'Show',
          value: filter,
          onChange: setFilter,
          options: [
            { value: 'all', label: 'All' },
            { value: 'in', label: 'Included' },
            { value: 'flag', label: 'Flagged', count: flagged }
          ]
        }}
        actions={
          <Button variant="ghost" icon="plus" onClick={() => setEditing({ mode: 'add' })}>
            Add question
          </Button>
        }
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
              { id: 'gaps', label: 'Find gaps in the journey', seconds: 12, onSelect: findGaps },
              {
                id: 'rewrite',
                label: 'Rewrite like a buyer',
                seconds: 40,
                icon: 'wand',
                onSelect: () => rewrite([])
              },
              {
                id: 'overlaps',
                label: 'Mark overlapping pairs',
                seconds: 8,
                icon: 'merge',
                onSelect: findGaps
              }
            ]}
          />
        }
        group={stageGroup((_rows, stage) => {
          const all = questions.filter((question) => question.stage === stage)
          return `${all.filter((q) => q.included).length} of ${all.length} · ${TOPIC_STAGE_HINT[stage]}`
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
                  moveTo(ids, stage)
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
        empty={<p className="tw-muted">No questions yet. Go back and write them.</p>}
        maxBodyHeight={480}
      />
    </StepFrame>
  )
}
