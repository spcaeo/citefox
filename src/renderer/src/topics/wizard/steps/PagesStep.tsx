import { useEffect, useState, type JSX } from 'react'
import { TOPIC_STAGE_LABEL, type TopicDraftPrompt } from '@shared/domain'
import type { TopicPageBrief, TopicPageCandidate, TopicTarget } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { formatMoment } from '../../../utils/dates'
import {
  AiMenu,
  Button,
  Chip,
  IconButton,
  ListGrid,
  Panel,
  SegmentedControl,
  UrlText,
  type ListColumn,
  type MenuItem
} from '../../../ui'
import { AiCard } from '../components/AiCard'
import { PageBriefPanel } from '../components/PageBriefPanel'
import { questionNumbers } from '../components/questionColumns'
import { StepFrame } from '../components/StepFrame'
import { useAiRun } from '../hooks/useAiRun'
import { included, keywordsOf, questionsOf } from '../utils/draft'
import { usePrimary, type StepProps } from './shared'

type MatchGroup = 'none' | 'low' | 'medium' | 'high'

const GROUP_LABEL: Readonly<Record<MatchGroup, string>> = {
  none: 'No page yet',
  low: 'Low match',
  medium: 'Medium match',
  high: 'High match'
}

const GROUP_HINT: Readonly<Record<MatchGroup, string>> = {
  none: 'Needs a new page',
  low: 'Only loosely related',
  medium: 'A section answers it',
  high: 'A title or heading answers it'
}

function matchGroup(prompt: TopicDraftPrompt): MatchGroup {
  if (!prompt.targetUrl) return 'none'
  const confidence = prompt.matchConfidence ?? 0
  if (prompt.matchStatus === 'confirmed' && prompt.matchConfidence === null) return 'high'
  if (confidence >= 75) return 'high'
  if (confidence >= 45) return 'medium'
  return 'low'
}

function pathOf(url: string | null): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.pathname || '/'
  } catch {
    return url
  }
}

function sitemapLabel(iso: string | null): string | null {
  if (!iso) return null
  if (Number.isNaN(new Date(iso).getTime())) return null
  return `Sitemap read ${formatMoment(iso)}`
}

/** Pages (Seed-Pages.png): which own page answers each prompt, with confidence and reason. */
export function PagesStep(props: StepProps): JSX.Element {
  const { draft, project, client, flush, replace } = props
  const primary = usePrimary(props)
  const [explained, setExplained] = useState<{ label: string; text: string } | null>(null)
  const briefRun = useAiRun<TopicPageBrief>()
  const [candidates, setCandidates] = useState<readonly TopicPageCandidate[]>([])
  const [sitemapAt, setSitemapAt] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [kind, setKind] = useState<'question' | 'keyword'>('question')
  const [targeting, setTargeting] = useState<readonly string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    client['topics:pageCandidates']({ projectId: project.id }).then(
      (result) => {
        if (cancelled) return
        setCandidates(result.candidates)
        setSitemapAt(result.sitemapReadAt)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client, project.id])

  const questions = questionsOf(draft)
  const keywords = keywordsOf(draft)
  const numbers = questionNumbers(questions)
  const pool = included(kind === 'question' ? questions : keywords)
  const confirmed = pool.filter((prompt) => prompt.matchStatus === 'confirmed').length
  const noPage = pool.filter((prompt) => !prompt.targetUrl).length
  const toConfirm = pool.filter(
    (prompt) => prompt.targetUrl && prompt.matchStatus !== 'confirmed'
  ).length
  const highToConfirm = pool.filter(
    (prompt) =>
      prompt.targetUrl && prompt.matchStatus !== 'confirmed' && (prompt.matchConfidence ?? 0) >= 75
  )
  const rows = pool.filter((prompt) => {
    if (filter === 'todo') return Boolean(prompt.targetUrl) && prompt.matchStatus !== 'confirmed'
    if (filter === 'done') return prompt.matchStatus === 'confirmed'
    return true
  })
  const label = (row: TopicDraftPrompt): string =>
    row.kind === 'question' ? `Q${numbers.get(row.id) ?? ''}` : row.text

  async function setTarget(promptIds: readonly string[], target?: TopicTarget): Promise<void> {
    setBusy(true)
    primary.setError(null)
    try {
      const saved = (await flush()) ?? draft
      const result = await client['topics:setTarget']({
        projectId: project.id,
        draftId: saved.id,
        promptIds,
        ...(target ? { target } : {})
      })
      if (result.draft) replace(result.draft)
    } catch (cause) {
      primary.setError(errorText(cause, 'Could not change the target page.'))
    } finally {
      setBusy(false)
    }
  }

  async function rematch(): Promise<void> {
    setBusy(true)
    try {
      const saved = (await flush()) ?? draft
      replace(
        (await client['topics:matchPages']({ projectId: project.id, draftId: saved.id })).draft
      )
    } catch (cause) {
      primary.setError(errorText(cause, 'CiteFox AI could not match the pages.'))
    } finally {
      setBusy(false)
    }
  }

  function brief(row: TopicDraftPrompt): void {
    briefRun.run({
      id: `brief:${row.id}`,
      title: `Page brief · ${label(row)}`,
      seconds: 20,
      call: async () => {
        const saved = (await flush()) ?? draft
        return client['topics:draftPageBrief']({
          projectId: project.id,
          draftId: saved.id,
          promptId: row.id
        })
      }
    })
  }

  /** The saved match reason, shown in plain words (no new Claude call). */
  function explainMatch(row: TopicDraftPrompt): void {
    setExplained({
      label: label(row),
      text: row.targetUrl
        ? `${pathOf(row.targetUrl)} · ${row.matchConfidence ?? '–'}% match. ${row.matchReason ?? ''}`.trim()
        : (row.matchReason ?? 'No page on your site answers this yet.')
    })
  }

  const columns: ListColumn<TopicDraftPrompt>[] = [
    ...(kind === 'question'
      ? [
          {
            id: 'q',
            label: 'Q',
            width: 64,
            sort: (row: TopicDraftPrompt) => numbers.get(row.id) ?? 0,
            render: (row: TopicDraftPrompt) => (
              <span className="tw-qnum num">Q{numbers.get(row.id)}</span>
            )
          }
        ]
      : []),
    {
      id: 'text',
      label: kind === 'question' ? 'Question' : 'Keyword',
      width: 'fill',
      minWidth: 260,
      sort: (row) => row.text,
      render: (row) => (
        <span className="tw-clamp" title={row.text}>
          {row.text}
        </span>
      )
    },
    {
      id: 'stage',
      label: kind === 'question' ? 'Stage' : 'Group',
      width: kind === 'question' ? 96 : 180,
      sort: (row) => (kind === 'question' ? (row.stage ?? '') : (row.kwGroup ?? '')),
      render: (row) =>
        kind === 'question' ? (
          row.stage ? (
            TOPIC_STAGE_LABEL[row.stage]
          ) : (
            '—'
          )
        ) : (
          <span className="tw-clamp">{row.kwGroup ?? '—'}</span>
        )
    },
    {
      id: 'target',
      label: 'Target page',
      width: 260,
      sort: (row) => row.targetUrl ?? '',
      render: (row) =>
        row.targetUrl ? (
          <UrlText url={row.targetUrl} label={pathOf(row.targetUrl)} />
        ) : (
          <span className="tw-muted">No page yet</span>
        )
    },
    {
      id: 'status',
      label: 'Status',
      width: 140,
      sort: (row) => (row.matchStatus === 'confirmed' ? 2 : row.targetUrl ? 1 : 0),
      render: (row) =>
        !row.targetUrl ? (
          <Chip size="sm">Write a page</Chip>
        ) : row.matchStatus === 'confirmed' ? (
          <Chip size="sm" tone="ok">
            Confirmed
          </Chip>
        ) : (
          <span className="tw-muted">To confirm</span>
        )
    }
  ]

  function rowMenu(row: TopicDraftPrompt): MenuItem[] {
    return [
      {
        id: 'set',
        label: 'Set target page',
        icon: 'target',
        onSelect: () => setTargeting([row.id])
      },
      {
        id: 'confirm',
        label: 'Confirm',
        icon: 'check',
        disabled: !row.targetUrl || row.matchStatus === 'confirmed',
        onSelect: () => void setTarget([row.id])
      },
      {
        id: 'none',
        label: 'Mark no page yet',
        icon: 'x',
        disabled: !row.targetUrl,
        onSelect: () => void setTarget([row.id], { pageId: null, url: null })
      },
      {
        id: 'explain',
        label: 'Explain this match',
        icon: 'bulb',
        onSelect: () => explainMatch(row)
      },
      {
        id: 'brief',
        label: 'Draft a page brief',
        hint: '20 s',
        tone: 'ai',
        icon: 'sparkle',
        onSelect: () => brief(row)
      }
    ]
  }

  const firstGap = pool.find((prompt) => !prompt.targetUrl)
  const sitemap = sitemapLabel(sitemapAt)
  const briefResult = briefRun.result
  const briefRow = briefRun.actionId
    ? pool.find((row) => `brief:${row.id}` === briefRun.actionId)
    : undefined

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title={
        kind === 'question' ? 'Which page answers each question' : 'Which page answers each keyword'
      }
      aside="High: a title or heading answers it. Medium: a section does."
      headerEnd={
        keywords.length > 0 && questions.length > 0 ? (
          <SegmentedControl
            label="Question kind"
            value={kind}
            onChange={(value) => {
              setKind(value)
              setFilter('all')
            }}
            options={[
              { value: 'question', label: 'Questions' },
              { value: 'keyword', label: 'Keywords' }
            ]}
          />
        ) : null
      }
      footer={{
        onBack: props.back,
        note: primary.error ?? `${pool.length - noPage} have a target page · ${noPage} no page yet`,
        noteTone: primary.error ? 'warn' : 'neutral',
        primary: {
          label: 'See estimate',
          busy: primary.busy,
          onClick: () => void primary.advance('estimate')
        }
      }}
    >
      {targeting ? (
        <TargetPicker
          count={targeting.length}
          candidates={candidates}
          onCancel={() => setTargeting(null)}
          onPick={(candidate) => {
            const ids = targeting
            setTargeting(null)
            void setTarget(
              ids,
              candidate
                ? { pageId: candidate.pageId, url: candidate.url }
                : { pageId: null, url: null }
            )
          }}
        />
      ) : null}
      {briefResult && briefRun.phase === 'ready' ? (
        <PageBriefPanel
          brief={briefResult}
          label={briefRow ? label(briefRow) : 'this question'}
          onClose={briefRun.close}
        />
      ) : briefRun.phase !== 'idle' ? (
        <AiCard state={briefRun} />
      ) : null}
      {explained ? (
        <div className="tw-line" role="status">
          <p>
            <strong>{explained.label}:</strong> {explained.text}
          </p>
          <IconButton
            icon="x"
            size="sm"
            label="Close explanation"
            onClick={() => setExplained(null)}
          />
        </div>
      ) : null}
      <ListGrid
        label={kind === 'question' ? 'Target pages for questions' : 'Target pages for keywords'}
        noun={kind === 'question' ? ['question', 'questions'] : ['keyword', 'keywords']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={label}
        columns={columns}
        search={{ text: (row) => `${row.text} ${row.targetUrl ?? ''}` }}
        filter={{
          label: 'Show',
          value: filter,
          onChange: setFilter,
          options: [
            { value: 'all', label: 'All', count: pool.length },
            { value: 'todo', label: 'To confirm', count: toConfirm },
            { value: 'done', label: 'Confirmed', count: confirmed }
          ]
        }}
        actions={
          <>
            {sitemap ? <span className="tw-help">{sitemap}</span> : null}
            <Button
              variant="ghost"
              icon="check"
              disabled={highToConfirm.length === 0 || busy}
              onClick={() => void setTarget(highToConfirm.map((row) => row.id))}
            >
              Confirm all high ({highToConfirm.length})
            </Button>
          </>
        }
        ai={
          <AiMenu
            label="AI actions for target pages"
            actions={[
              {
                id: 'rematch',
                label: 'Match pages again',
                seconds: 20,
                icon: 'refresh',
                onSelect: () => void rematch()
              },
              {
                id: 'brief',
                label: firstGap ? `Draft a brief for ${label(firstGap)}` : 'Draft a page brief',
                seconds: 20,
                disabled: !firstGap,
                onSelect: () => {
                  if (firstGap) brief(firstGap)
                }
              }
            ]}
          />
        }
        group={{
          key: (row) => {
            const group = matchGroup(row)
            return { key: group, label: GROUP_LABEL[group] }
          },
          order: ['none', 'low', 'medium', 'high'],
          meta: (_rows, key) => GROUP_HINT[key as MatchGroup]
        }}
        bulk={({ selected, clear }) => {
          const ids = selected.map((row) => row.id)
          return (
            <>
              <Button
                size="sm"
                icon="check"
                onClick={() => {
                  void setTarget(ids.filter((id) => pool.find((p) => p.id === id)?.targetUrl))
                  clear()
                }}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                icon="target"
                onClick={() => {
                  setTargeting(ids)
                  clear()
                }}
              >
                Set target page
              </Button>
              <Button
                size="sm"
                icon="x"
                onClick={() => {
                  void setTarget(ids, { pageId: null, url: null })
                  clear()
                }}
              >
                Mark no page
              </Button>
            </>
          )
        }}
        rowMenu={rowMenu}
        summary={() =>
          `${pool.length} ${kind === 'question' ? 'questions' : 'keywords'} · ${confirmed} confirmed · ${toConfirm} to confirm · ${noPage} no page`
        }
        empty={<p className="tw-muted">Nothing to match yet.</p>}
        maxBodyHeight={480}
      />
    </StepFrame>
  )
}

function TargetPicker({
  count,
  candidates,
  onPick,
  onCancel
}: {
  count: number
  candidates: readonly TopicPageCandidate[]
  onPick: (candidate: TopicPageCandidate | null) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(candidates[0]?.url ?? '')
  return (
    <Panel label="Set target page" padding={16} className="tw-editor">
      <div className="tw-editor-row">
        <label className="tw-field tw-grow">
          <span className="tw-label">
            Target page for {count} {count === 1 ? 'question' : 'questions'}
          </span>
          <select
            className="ui-input tw-select mono"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.url} value={candidate.url}>
                {pathOf(candidate.url)}
                {candidate.source === 'sitemap' ? ' (sitemap)' : ''}
              </option>
            ))}
            <option value="">No page yet</option>
          </select>
        </label>
        {value ? <UrlText url={value} label={pathOf(value)} /> : null}
      </div>
      <div className="tw-editor-actions">
        <Button size="sm" onClick={() => onPick(candidates.find((c) => c.url === value) ?? null)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Panel>
  )
}
