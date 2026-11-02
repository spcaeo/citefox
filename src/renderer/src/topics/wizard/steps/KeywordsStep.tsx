import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  FUNNEL_LABEL,
  KEYWORD_INTENTS,
  type TopicDraft,
  type TopicDraftPrompt,
  type KeywordIntent
} from '@shared/domain'
import type {
  DiscoverTermsResult,
  MergeNearDuplicatesResult,
  MissingGroupsResult,
  TopicKeywordSummary
} from '@shared/ipc'
import {
  AiMenu,
  Button,
  Chip,
  ListGrid,
  MenuButton,
  Tabs,
  type ListColumn,
  type MenuItem
} from '../../../ui'
import { AiCard } from '../components/AiCard'
import { DepthSettings } from '../components/DepthSettings'
import { LineEditor } from '../components/LineEditor'
import { StepFrame } from '../components/StepFrame'
import { INTENT_LABEL } from '../constants'
import { READS_SITE, useAiRun } from '../hooks/useAiRun'
import { included, keywordsOf, pick, stepProblem } from '../utils/draft'
import { rangeText, searchRange } from '../utils/estimate'
import { promptInput } from '../utils/patch'
import { generateKeywords, restorePrompts, usePrimary, type StepProps } from './shared'

type KeywordTab = 'groups' | 'all' | 'depth'
type AiAnswer =
  | { kind: 'groups'; result: MissingGroupsResult }
  | { kind: 'merge'; result: MergeNearDuplicatesResult }
  | { kind: 'terms'; result: DiscoverTermsResult }

interface GroupRow {
  name: string
  kind: 'coverage' | 'intent'
  keywords: number
  included: number
  intent: string
  funnel: string
  pageType: string
  ids: readonly string[]
}

function groupRows(keywords: readonly TopicDraftPrompt[]): GroupRow[] {
  const map = new Map<string, TopicDraftPrompt[]>()
  for (const keyword of keywords) {
    const name = keyword.kwGroup ?? 'Ungrouped'
    map.set(name, [...(map.get(name) ?? []), keyword])
  }
  return [...map.entries()].map(([name, list]) => {
    const first = list[0]
    return {
      name,
      kind: first?.kwGroupKind ?? 'intent',
      keywords: list.length,
      included: list.filter((k) => k.included).length,
      intent: first?.intent ? INTENT_LABEL[first.intent] : '—',
      funnel: first?.funnel ? FUNNEL_LABEL[first.funnel] : '—',
      pageType: first?.pageType ?? '—',
      ids: list.map((k) => k.id)
    }
  })
}

/** Keywords and groups (Keywords-Groups.png): Groups | All keywords | Depth settings. */
export function KeywordsStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush, replace } = props
  const primary = usePrimary(props)
  const ai = useAiRun<AiAnswer>()
  const [tab, setTab] = useState<KeywordTab>(keywordsOf(draft).length > 0 ? 'all' : 'depth')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<TopicDraftPrompt | null>(null)
  const [summary, setSummary] = useState<TopicKeywordSummary | null>(null)
  const [generating, setGenerating] = useState(false)
  const before = useRef<TopicDraft | null>(null)

  const keywords = keywordsOf(draft)
  const kept = included(keywords)
  const groups = groupRows(keywords)
  const groupNames = groups.map((group) => group.name)
  const keptCount = kept.length

  const draftKey = draft.id
  useEffect(() => {
    let cancelled = false
    // Recount a moment after the kept keywords change (the patch saves first).
    const timer = setTimeout(() => {
      client['topics:keywordSummary']({ projectId: project.id, draftId: draftKey }).then(
        (next) => {
          if (!cancelled) setSummary(next)
        },
        () => undefined
      )
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [keptCount, client, project.id, draftKey])

  async function draftId(): Promise<string> {
    return ((await flush()) ?? draft).id
  }

  function runAi(kind: AiAnswer['kind']): void {
    const titles = {
      groups: 'Suggest missing groups',
      merge: 'Merge near-duplicates',
      terms: 'Discover synonyms'
    }
    ai.run({
      id: kind,
      title: titles[kind],
      seconds: kind === 'groups' ? 15 : kind === 'merge' ? 8 : 20,
      ...(kind === 'terms' ? { reads: READS_SITE } : {}),
      call: async () => {
        const id = await draftId()
        if (kind === 'groups')
          return {
            kind,
            result: await client['topics:suggestMissingGroups']({
              projectId: project.id,
              draftId: id
            })
          }
        if (kind === 'merge')
          return {
            kind,
            result: await client['topics:mergeNearDuplicates']({
              projectId: project.id,
              draftId: id,
              apply: false
            })
          }
        return {
          kind,
          result: await client['topics:discoverTerms']({ projectId: project.id, draftId: id })
        }
      }
    })
  }

  async function apply(ids: readonly string[]): Promise<void> {
    const answer = ai.result
    if (!answer) return
    before.current = draft
    if (answer.kind === 'groups') {
      const picked = answer.result.groups
        .flatMap((group) => group.keywords)
        .filter((k) => ids.includes(k.id))
      patch({
        upsertPrompts: picked.map((k) => ({
          kind: 'keyword',
          text: k.text,
          source: 'claude',
          kwGroup: k.kwGroup,
          kwGroupKind: k.kwGroupKind,
          kwFamily: k.kwFamily,
          intent: k.intent,
          funnel: k.funnel,
          pageType: k.pageType
        }))
      })
    } else if (answer.kind === 'merge') {
      const result = await client['topics:mergeNearDuplicates']({
        projectId: project.id,
        draftId: await draftId(),
        apply: true
      })
      if (result.draft) replace(result.draft)
    } else {
      patch({ keywordTerms: answer.result.terms.filter((term) => ids.includes(term.id)) })
    }
  }

  function undo(): void {
    const snapshot = before.current
    if (!snapshot) return
    if (ai.result?.kind === 'terms') {
      patch({ keywordTerms: snapshot.keywordTerms })
      return
    }
    void flush().then((saved) => {
      const restore = restorePrompts(snapshot, saved ?? draft)
      if (restore.removePromptIds || restore.upsertPrompts) patch(restore)
    })
  }

  async function regenerate(): Promise<void> {
    setGenerating(true)
    primary.setError(null)
    try {
      const result = await generateKeywords(client, project.id, await draftId(), true)
      replace(result.draft)
      setSummary(result.summary)
      setTab('all')
    } catch (cause) {
      primary.setError(
        cause instanceof Error ? cause.message : 'CiteFox AI could not generate keywords.'
      )
    } finally {
      setGenerating(false)
    }
  }

  function update(ids: readonly string[], change: Parameters<typeof promptInput>[1]): void {
    patch({
      upsertPrompts: pick(keywords, ids).map((keyword) => promptInput(keyword, change))
    })
  }

  const keywordColumns = useMemo<ListColumn<TopicDraftPrompt>[]>(
    () => [
      {
        id: 'keyword',
        label: 'Keyword',
        width: 'fill',
        sort: (row) => row.text,
        render: (row) => (
          <span className={row.included ? 'tw-clamp' : 'tw-clamp tw-out'}>{row.text}</span>
        )
      },
      {
        id: 'intent',
        label: 'Intent',
        width: 144,
        sort: (row) => row.intent ?? '',
        render: (row) => (row.intent ? INTENT_LABEL[row.intent] : '—')
      },
      {
        id: 'funnel',
        label: 'Funnel',
        width: 88,
        sort: (row) => row.funnel ?? '',
        render: (row) => (row.funnel ? FUNNEL_LABEL[row.funnel] : '—')
      },
      {
        id: 'type',
        label: 'Page type',
        width: 160,
        sort: (row) => row.pageType ?? '',
        render: (row) => row.pageType ?? '—'
      }
    ],
    []
  )

  const groupColumns = useMemo<ListColumn<GroupRow>[]>(
    () => [
      {
        id: 'name',
        label: 'Group',
        width: 'fill',
        sort: (row) => row.name,
        render: (row) => row.name
      },
      {
        id: 'kind',
        label: 'Kind',
        width: 112,
        sort: (row) => row.kind,
        render: (row) => (
          <Chip size="sm" tone={row.kind === 'coverage' ? 'info' : 'neutral'}>
            {row.kind === 'coverage' ? 'Coverage' : 'Intent'}
          </Chip>
        )
      },
      {
        id: 'n',
        label: 'Keywords',
        width: 104,
        numeric: true,
        sort: (row) => row.keywords,
        render: (row) =>
          row.included === row.keywords ? row.keywords : `${row.included} of ${row.keywords}`
      },
      {
        id: 'intent',
        label: 'Intent · funnel',
        width: 180,
        sort: (row) => row.intent,
        render: (row) => `${row.intent} · ${row.funnel}`
      },
      {
        id: 'type',
        label: 'Page type',
        width: 150,
        sort: (row) => row.pageType,
        render: (row) => row.pageType
      }
    ],
    []
  )

  function keywordMenu(row: TopicDraftPrompt): MenuItem[] {
    return [
      { id: 'edit', label: 'Edit keyword', icon: 'pencil', onSelect: () => setEditing(row) },
      {
        id: 'move',
        label: 'Move to another group',
        icon: 'layers',
        onSelect: () => setEditing(row)
      },
      {
        id: 'toggle',
        label: row.included ? 'Leave out of the check' : 'Include in the check',
        icon: row.included ? 'x' : 'check',
        onSelect: () => update([row.id], { included: !row.included })
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

  function groupMenu(row: GroupRow): MenuItem[] {
    return [
      {
        id: 'open',
        label: 'Open keywords',
        icon: 'eye',
        onSelect: () => {
          setFilter(row.kind === 'coverage' ? 'coverage' : 'intent')
          setTab('all')
        }
      },
      {
        id: 'toggle',
        label: row.included > 0 ? 'Leave out of check' : 'Include in check',
        icon: row.included > 0 ? 'x' : 'check',
        onSelect: () => update(row.ids, { included: row.included === 0 })
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => patch({ removePromptIds: row.ids })
      }
    ]
  }

  const aiMenu = (
    <AiMenu
      label="AI actions for keywords"
      actions={[
        {
          id: 'groups',
          label: 'Suggest missing groups',
          seconds: 15,
          icon: 'layers',
          onSelect: () => runAi('groups')
        },
        {
          id: 'merge',
          label: 'Merge near-duplicates',
          seconds: 8,
          icon: 'merge',
          onSelect: () => runAi('merge')
        },
        {
          id: 'terms',
          label: 'Discover synonyms',
          seconds: 20,
          icon: 'compass',
          onSelect: () => runAi('terms')
        }
      ]}
    />
  )

  const markets = Math.max(1, draft.marketIds.length)
  const range = searchRange(kept.length, markets)
  const left = summary?.searchesLeft ?? null
  const over = left !== null && range.high > left
  const problem = stepProblem(draft, 'keywords')
  const answer = ai.result
  const rows = keywords.filter((k) => filter === 'all' || k.kwGroupKind === filter)
  const groupsLine = `${kept.length} keywords in ${groups.length} groups · ≈${rangeText(range.low, range.high)} searches per market${left !== null ? ` · ${left.toLocaleString('en-US')} left` : ''}`

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Keywords and groups"
      headerEnd={<p className="tw-help">Scored apart from buyer questions, with their own goal</p>}
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          problem ??
          (over
            ? `${kept.length} keywords need ${rangeText(range.low, range.high)} searches · you have ${left}`
            : groupsLine),
        noteTone: primary.error || problem || over ? 'warn' : 'neutral',
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
      <Tabs<KeywordTab>
        label="Keyword views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'groups', label: 'Groups', count: groups.length },
          { id: 'all', label: 'All keywords', count: keywords.length },
          { id: 'depth', label: 'Depth settings' }
        ]}
      />
      {ai.phase !== 'idle' ? (
        <AiCard
          state={ai}
          info={answer?.kind === 'merge' ? null : (answer?.result.info ?? null)}
          meta={
            answer?.kind === 'merge'
              ? `${answer.result.pairs.length} near-duplicate pairs would likely show the same AI Overview`
              : undefined
          }
          items={
            answer?.kind === 'groups'
              ? answer.result.groups.flatMap((group) =>
                  group.keywords.map((k) => ({
                    id: k.id,
                    label: group.name,
                    text: k.text,
                    detail: group.reason
                  }))
                )
              : answer?.kind === 'merge'
                ? answer.result.pairs.map((pair) => ({
                    id: pair.dropId,
                    label: `Keep “${pair.keep}”`,
                    text: `Drop “${pair.drop}”`,
                    detail: pair.reason
                  }))
                : answer?.kind === 'terms'
                  ? answer.result.terms.map((term) => ({
                      id: term.id,
                      text: term.term,
                      detail: term.synonyms.join(', ')
                    }))
                  : undefined
          }
          {...(answer
            ? {
                onApply: (ids: string[]) => void apply(ids),
                onUndo: undo,
                applyLabel:
                  answer.kind === 'merge'
                    ? 'Merge pairs'
                    : answer.kind === 'terms'
                      ? 'Use these terms'
                      : 'Add keywords'
              }
            : {})}
        />
      ) : null}
      {tab === 'depth' ? (
        <DepthSettings
          draft={draft}
          patch={patch}
          generating={generating}
          hasKeywords={keywords.length > 0}
          onGenerate={() => void regenerate()}
        />
      ) : tab === 'groups' ? (
        <ListGrid
          label="Keyword groups"
          noun={['group', 'groups']}
          rows={groups}
          rowKey={(row) => row.name}
          rowLabel={(row) => row.name}
          columns={groupColumns}
          search={{ text: (row) => row.name }}
          ai={aiMenu}
          initialSort={[{ key: 'n', dir: 'desc' }]}
          bulk={({ selected, clear }) => (
            <>
              <Button
                size="sm"
                icon="x"
                onClick={() => {
                  update(
                    selected.flatMap((g) => g.ids),
                    { included: false }
                  )
                  clear()
                }}
              >
                Leave out
              </Button>
              <Button
                size="sm"
                icon="trash"
                onClick={() => {
                  patch({ removePromptIds: selected.flatMap((g) => g.ids) })
                  clear()
                }}
              >
                Remove
              </Button>
            </>
          )}
          rowMenu={groupMenu}
          summary={() =>
            `${groups.length} groups · ${groups.filter((g) => g.kind === 'coverage').length} coverage, ${groups.filter((g) => g.kind === 'intent').length} intent`
          }
          empty={
            <p className="tw-muted">No keywords yet. Open Depth settings and generate them.</p>
          }
          maxBodyHeight={480}
        />
      ) : (
        <>
          {editing ? (
            <LineEditor
              title="Edit keyword"
              label="Keyword"
              initialText={editing.text}
              choiceLabel="Group"
              choices={groupNames.map((name) => ({ value: name, label: name }))}
              initialChoice={editing.kwGroup ?? groupNames[0] ?? ''}
              multiline={false}
              onCancel={() => setEditing(null)}
              onSave={(text, choice) => {
                const target = groups.find((group) => group.name === choice)
                const sample = keywords.find((k) => k.kwGroup === choice)
                update([editing.id], {
                  text,
                  kwGroup: choice,
                  ...(target && sample
                    ? {
                        kwGroupKind: sample.kwGroupKind,
                        kwFamily: sample.kwFamily,
                        intent: sample.intent,
                        funnel: sample.funnel,
                        pageType: sample.pageType
                      }
                    : {})
                })
                setEditing(null)
              }}
            />
          ) : null}
          <ListGrid
            label="Keywords"
            noun={['keyword', 'keywords']}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.text}
            columns={keywordColumns}
            search={{ text: (row) => `${row.text} ${row.kwGroup ?? ''}` }}
            filter={{
              label: 'Group kind',
              value: filter,
              onChange: setFilter,
              options: [
                { value: 'all', label: 'All' },
                { value: 'coverage', label: 'Coverage' },
                { value: 'intent', label: 'Intent' }
              ]
            }}
            ai={aiMenu}
            initialSort={[{ key: 'keyword', dir: 'asc' }]}
            group={{
              key: (row) => ({
                key: row.kwGroup ?? 'Ungrouped',
                label: row.kwGroup ?? 'Ungrouped'
              }),
              order: groupNames
                .slice()
                .sort((a, b) => (a.startsWith('Core') ? -1 : b.startsWith('Core') ? 1 : 0)),
              meta: (groupRows) => {
                const first = groupRows[0]
                if (!first) return null
                const parts = [
                  first.kwGroupKind === 'coverage' ? 'Coverage' : 'Intent',
                  first.intent ? INTENT_LABEL[first.intent] : null,
                  first.funnel ? FUNNEL_LABEL[first.funnel] : null
                ].filter(Boolean)
                const branded =
                  first.kwFamily === 'branded_defensive' || /^Branded/.test(first.kwGroup ?? '')
                return `${parts.join(' · ')}${branded ? ' · Kept apart from the topic score' : ''}`
              }
            }}
            bulk={({ selected, clear }) => {
              const ids = selected.map((row) => row.id)
              return (
                <>
                  <MenuButton
                    label="Move to group"
                    align="start"
                    items={groupNames.map((name) => ({
                      id: name,
                      label: name,
                      onSelect: () => {
                        update(ids, { kwGroup: name })
                        clear()
                      }
                    }))}
                    trigger={({ ref, ...rest }) => (
                      <Button ref={ref} size="sm" icon="layers" iconEnd="chevron-down" {...rest}>
                        Move to group
                      </Button>
                    )}
                  />
                  <MenuButton
                    label="Change intent"
                    align="start"
                    items={KEYWORD_INTENTS.map((intent: KeywordIntent) => ({
                      id: intent,
                      label: INTENT_LABEL[intent],
                      onSelect: () => {
                        update(ids, { intent })
                        clear()
                      }
                    }))}
                    trigger={({ ref, ...rest }) => (
                      <Button ref={ref} size="sm" iconEnd="chevron-down" {...rest}>
                        Change intent
                      </Button>
                    )}
                  />
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
            rowMenu={keywordMenu}
            summary={() => `${keywords.length} keywords in ${groups.length} groups`}
            empty={
              <p className="tw-muted">No keywords yet. Open Depth settings and generate them.</p>
            }
            maxBodyHeight={480}
          />
        </>
      )}
    </StepFrame>
  )
}
