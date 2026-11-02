import { useRef, useState, type JSX } from 'react'
import {
  TOPIC_STAGE_LABEL,
  type TopicDraft,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import type { QuestionCleanupResult, TopicPromptSuggestions } from '@shared/ipc'
import {
  AiMenu,
  Button,
  Chip,
  ToolButton,
  ListGrid,
  Panel,
  UiIcon,
  type ListColumn,
  type MenuItem
} from '../../../ui'
import { AiCard } from '../components/AiCard'
import { LineEditor } from '../components/LineEditor'
import { STAGE_CHOICES, stageGroup } from '../components/questionColumns'
import { StageMenuButton } from '../components/questionGrid'
import { StepFrame } from '../components/StepFrame'
import { useAiRun } from '../hooks/useAiRun'
import { included, pick, questionsOf, stepProblem } from '../utils/draft'
import { promptInput } from '../utils/patch'
import { namesAny } from '../utils/text'
import { restorePrompts, usePrimary, type StepProps } from './shared'

type Answer =
  | { kind: 'cleanup'; result: QuestionCleanupResult }
  | { kind: 'rewrite'; result: TopicPromptSuggestions }

/** My own questions, clean up (Questions-Import.png): merged, flagged, tagged by stage. */
export function CleanupStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush } = props
  const primary = usePrimary(props)
  const ai = useAiRun<Answer>()
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<TopicDraftPrompt | null>(null)
  const [originals, setOriginals] = useState<TopicDraftPrompt | null>(null)
  const [cleaned, setCleaned] = useState(0)
  const before = useRef<TopicDraft | null>(null)

  const questions = questionsOf(draft)
  const kept = included(questions)
  const isBrand = (row: TopicDraftPrompt): boolean =>
    row.flags.includes('brand') || namesAny(row.text, draft.brandNames)
  const flagged = questions.filter((row) => row.flags.length > 0)
  const brand = questions.filter(isBrand)
  const rows = questions.filter((row) =>
    filter === 'flag' ? row.flags.length > 0 : filter === 'brand' ? isBrand(row) : true
  )
  const stats = draft.importStats
  const source = draft.importSource

  async function draftId(): Promise<string> {
    return ((await flush()) ?? draft).id
  }

  function cleanup(): void {
    ai.run({
      id: 'cleanup',
      title: 'Clean up and tag with CiteFox AI',
      seconds: 20,
      call: async () => ({
        kind: 'cleanup',
        result: await client['topics:cleanupWithClaude']({
          projectId: project.id,
          draftId: await draftId()
        })
      })
    })
  }

  function rewriteFragments(): void {
    const ids = questions.filter((row) => row.flags.includes('short')).map((row) => row.id)
    ai.run({
      id: 'rewrite',
      title: 'Rewrite fragments',
      seconds: 10,
      call: async (instruction) => ({
        kind: 'rewrite',
        result: await client['topics:rewriteQuestion']({
          projectId: project.id,
          draftId: await draftId(),
          promptIds: ids,
          instruction
        })
      })
    })
  }

  function apply(ids: readonly string[]): void {
    const answer = ai.result
    if (!answer) return
    before.current = draft
    if (answer.kind === 'cleanup') {
      const items = answer.result.items.filter((item) => ids.includes(item.id))
      const byId = new Map(items.map((item) => [item.id, item]))
      patch({
        upsertPrompts: pick(
          questions,
          items.map((item) => item.id)
        ).map((row) => {
          const item = byId.get(row.id)
          return promptInput(row, {
            text: item?.after ?? row.text,
            ...(item?.stage ? { stage: item.stage } : {}),
            ...(item && !namesAny(item.after, draft.brandNames) ? { included: true } : {})
          })
        })
      })
      setCleaned(items.length)
      // The grid shows the result; the toolbar line keeps Undo.
      ai.close()
    } else {
      const items = answer.result.suggestions.filter((item) => ids.includes(item.id))
      patch({
        upsertPrompts: items.flatMap((item) => {
          const row = item.replacesId ? questions.find((q) => q.id === item.replacesId) : undefined
          return row ? [promptInput(row, { text: item.text })] : []
        })
      })
    }
  }

  function undo(): void {
    const snapshot = before.current
    if (!snapshot) return
    void flush().then((saved) => {
      const restore = restorePrompts(snapshot, saved ?? draft)
      if (restore.removePromptIds || restore.upsertPrompts) patch(restore)
    })
    setCleaned(0)
  }

  function setIncluded(ids: readonly string[], value: boolean): void {
    patch({
      upsertPrompts: pick(questions, ids).map((row) => promptInput(row, { included: value }))
    })
  }

  const columns: ListColumn<TopicDraftPrompt>[] = [
    {
      id: 'text',
      label: 'Question',
      width: 'fill',
      minWidth: 280,
      sort: (row) => row.text,
      render: (row) => (
        <span className={row.included ? 'tw-clamp' : 'tw-clamp tw-out'} title={row.text}>
          {row.text}
        </span>
      )
    },
    {
      id: 'source',
      label: 'Source',
      width: 120,
      sort: (row) => row.sourceNote ?? '',
      render: (row) => row.sourceNote ?? '—'
    },
    {
      id: 'flags',
      label: 'Flags',
      width: 150,
      render: (row) => (
        <span className="tw-flags">
          {row.flags.includes('brand') ? (
            <Chip tone="warn" size="sm">
              Names brand
            </Chip>
          ) : null}
          {row.flags.includes('short') ? <Chip size="sm">Very short</Chip> : null}
          {row.flags.includes('merged') ? (
            <Chip tone="info" size="sm">
              {row.mergedFrom.length + 1} merged
            </Chip>
          ) : null}
        </span>
      )
    },
    {
      id: 'in',
      label: 'In topic',
      width: 132,
      sort: (row) => (row.included ? 1 : 0),
      render: (row) =>
        isBrand(row) && !row.included ? (
          <span className="tw-warn-text">Brand question</span>
        ) : row.included ? (
          'Kept'
        ) : (
          <span className="tw-muted">Left out</span>
        )
    }
  ]

  function rowMenu(row: TopicDraftPrompt): MenuItem[] {
    const items: MenuItem[] = [
      { id: 'edit', label: 'Edit wording', icon: 'pencil', onSelect: () => setEditing(row) },
      {
        id: 'move',
        label: 'Move to another stage',
        icon: 'layers',
        onSelect: () => setEditing(row)
      }
    ]
    if (row.mergedFrom.length > 0) {
      items.push({
        id: 'merged',
        label: 'See merged originals',
        icon: 'merge',
        onSelect: () => setOriginals(row)
      })
    }
    items.push(
      {
        id: 'toggle',
        label: row.included ? 'Leave out of topic' : 'Keep in topic',
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

  const answer = ai.result
  const problem = stepProblem(draft, 'cleanup')
  const summaryLine = [
    `${kept.length} kept`,
    stats?.duplicatesMerged ? `${stats.duplicatesMerged} duplicates merged` : null,
    brand.length ? `${brand.length} name ${draft.brandNames[0] ?? 'your brand'}` : null,
    stats?.shortFlagged ? `${stats.shortFlagged} very short` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Add your own questions"
      headerEnd={
        <label className="tw-inline-field">
          <span className="tw-label">Topic name</span>
          <input
            className="ui-input"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
      }
      footer={{
        onBack: props.back,
        note:
          primary.error ?? problem ?? `${kept.length} kept for the topic · no searches used yet`,
        noteTone: primary.error || problem ? 'warn' : 'neutral',
        primary: {
          label: 'Match pages',
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
      <Panel label="Imported from" padding={16} className="tw-sources">
        <div className="tw-source-row">
          {source && source.pastedLines > 0 ? (
            <span className="tw-source">
              <UiIcon name="clipboard" />
              <strong>Pasted</strong>
              <span className="tw-help num">{source.pastedLines} lines</span>
              <Button variant="text" onClick={() => props.goTo('import')}>
                Edit
              </Button>
            </span>
          ) : null}
          {source?.csvFileName ? (
            <span className="tw-source">
              <UiIcon name="file" />
              <strong>{source.csvFileName}</strong>
              <span className="tw-help num">
                {source.csvRows} rows
                {source.csvColumns.length > 0 ? ` · ${source.csvColumns.join(', ')}` : ''}
              </span>
              <Button variant="text" onClick={() => props.goTo('import')}>
                Change
              </Button>
            </span>
          ) : null}
          <span className="tw-spacer" />
          <ToolButton kind="upload" label="Add more" onClick={() => props.goTo('import')} />
        </div>
      </Panel>
      {originals ? (
        <div className="tw-line" role="status">
          <p>
            <strong>Merged into “{originals.text}”:</strong> {originals.mergedFrom.join(' · ')}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setOriginals(null)}>
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
          info={answer?.result.info ?? null}
          items={
            answer?.kind === 'cleanup'
              ? answer.result.items.map((item) => ({
                  id: item.id,
                  label: `${item.change}${item.stage ? ` · ${TOPIC_STAGE_LABEL[item.stage]}` : ''}`,
                  text: item.after,
                  detail: `Before: ${item.before}`
                }))
              : answer?.result.suggestions.map((item) => ({
                  id: item.id,
                  text: item.text,
                  detail: item.reason
                }))
          }
          {...(answer ? { onApply: apply, onUndo: undo, applyLabel: 'Apply changes' } : {})}
        />
      ) : null}
      <ListGrid
        label="Imported questions"
        noun={['question', 'questions']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.text}
        columns={columns}
        search={{ text: (row) => `${row.text} ${row.sourceNote ?? ''}` }}
        filter={{
          label: 'Show',
          value: filter,
          onChange: setFilter,
          options: [
            { value: 'all', label: 'All', count: questions.length },
            { value: 'flag', label: 'Flagged', count: flagged.length },
            { value: 'brand', label: 'Brand', count: brand.length }
          ]
        }}
        toolbar={
          cleaned > 0 ? (
            <>
              <Chip tone="ok">
                <UiIcon name="sparkle" size={12} />
                {cleaned} lines cleaned
              </Chip>
              <Button size="sm" variant="text" onClick={undo}>
                Undo
              </Button>
            </>
          ) : null
        }
        ai={
          <AiMenu
            label="AI actions for imported questions"
            actions={[
              { id: 'cleanup', label: 'Clean up and tag', seconds: 20, onSelect: cleanup },
              {
                id: 'fragments',
                label: 'Rewrite fragments',
                seconds: 10,
                icon: 'wand',
                disabled: !questions.some((q) => q.flags.includes('short')),
                onSelect: rewriteFragments
              }
            ]}
          />
        }
        group={stageGroup((groupRows) => `${groupRows.length}`)}
        bulk={({ selected, clear }) => {
          const ids = selected.map((row) => row.id)
          return (
            <>
              <Button
                size="sm"
                icon="check"
                onClick={() => {
                  setIncluded(ids, true)
                  clear()
                }}
              >
                Keep
              </Button>
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
                    upsertPrompts: pick(questions, ids).map((row) => promptInput(row, { stage }))
                  })
                  clear()
                }}
              />
            </>
          )
        }}
        rowMenu={rowMenu}
        summary={() => summaryLine}
        empty={<p className="tw-muted">No questions yet. Go back and paste some.</p>}
        maxBodyHeight={460}
      />
    </StepFrame>
  )
}
