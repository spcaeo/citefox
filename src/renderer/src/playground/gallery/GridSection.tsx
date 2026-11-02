import { useMemo, useState, type JSX } from 'react'
import {
  AiMenu,
  Button,
  Chip,
  EmptyState,
  ListGrid,
  type ListColumn,
  type MenuItem
} from '../../ui'
import { GallerySection } from './GallerySection'
import { keywordRows, TODO_GROUPS, TODO_ROWS, type KeywordRow, type TodoRow } from './gridData'

const TODO_COLUMNS: ListColumn<TodoRow>[] = [
  {
    id: 'n',
    label: 'Q',
    width: 48,
    sort: (row) => row.n,
    render: (row) => <span className="gl-help num">Q{row.n}</span>
  },
  {
    id: 'text',
    label: 'Question',
    width: 'fill',
    sort: (row) => row.text,
    render: (row) => row.text
  },
  {
    id: 'url',
    label: 'Target page',
    width: 200,
    sort: (row) => row.url,
    cellClassName: 'mono',
    render: (row) => row.url ?? 'No page yet'
  },
  {
    id: 'odds',
    label: 'Win odds',
    width: 96,
    numeric: true,
    sort: (row) => row.odds,
    render: (row) => <strong>{row.odds}</strong>
  },
  { id: 'stage', label: 'Stage', width: 80, sort: (row) => row.stage, render: (row) => row.stage }
]

const KEYWORD_COLUMNS: ListColumn<KeywordRow>[] = [
  {
    id: 'keyword',
    label: 'Keyword',
    width: 'fill',
    sort: (row) => row.keyword,
    render: (row) => row.keyword
  },
  {
    id: 'intent',
    label: 'Intent',
    width: 144,
    sort: (row) => row.intent,
    render: (row) => row.intent
  },
  {
    id: 'funnel',
    label: 'Funnel',
    width: 88,
    sort: (row) => row.funnel,
    render: (row) => row.funnel
  },
  {
    id: 'type',
    label: 'Page type',
    width: 160,
    sort: (row) => row.pageType,
    render: (row) => row.pageType
  }
]

function todoMenu(row: TodoRow): MenuItem[] {
  return [
    { id: 'who', label: "See who's cited", icon: 'eye', onSelect: () => undefined },
    { id: 'target', label: 'Change target page', icon: 'target', onSelect: () => undefined },
    {
      id: 'why',
      label: "Why aren't we cited?",
      icon: 'sparkle',
      tone: 'ai',
      hint: '8 s',
      onSelect: () => undefined
    },
    { id: 'fix', label: 'Draft the fix', icon: 'wand', hint: '15 s', onSelect: () => undefined },
    {
      id: 'write',
      label: 'Write with 1000AIOverviews',
      icon: 'external',
      disabled: row.url !== null,
      onSelect: () => undefined
    }
  ]
}

const AI = (
  <AiMenu
    actions={[
      {
        id: 'prioritise',
        label: 'Prioritise',
        icon: 'prioritise',
        seconds: 8,
        onSelect: () => undefined
      },
      { id: 'explain', label: 'Explain', icon: 'bulb', seconds: 5, onSelect: () => undefined }
    ]}
  />
)

/** The one list grid: the Theme to-do grid, the Keywords grid, and the empty states. */
export function GridSection(): JSX.Element {
  const [status, setStatus] = useState('all')
  const [opened, setOpened] = useState<string | null>(null)
  const keywords = useMemo(() => keywordRows(), [])
  const todoRows = TODO_ROWS.filter((row) =>
    status === 'all' ? true : status === 'none' ? row.url === null : row.group === 'exists'
  )

  return (
    <GallerySection
      id="grid"
      title="List grid"
      intro="Every list in CiteFox is this one grid. Toolbar 56 · bulk bar 56 · header 40 · group 40 sticky · row 44 · footer 48. Numbers right-aligned and tabular; row actions behind the row menu."
    >
      <div className="gl-span-12 gl-stack">
        <ListGrid<TodoRow>
          label="To-do questions"
          noun={['question', 'questions']}
          rows={todoRows}
          rowKey={(row) => row.id}
          rowLabel={(row) => `Q${row.n}`}
          columns={TODO_COLUMNS}
          search={{ text: (row) => row.text }}
          filter={{
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: [
              { value: 'all', label: 'All' },
              { value: 'not-cited', label: 'Not cited' },
              { value: 'none', label: 'No page' }
            ]
          }}
          ai={AI}
          group={{
            key: (row) => ({ key: row.group, label: TODO_GROUPS[row.group] }),
            order: ['exists', 'none', 'right'],
            meta: (_rows, key) =>
              key === 'exists'
                ? 'Improve the target page'
                : key === 'none'
                  ? 'Write a page'
                  : 'Keep fresh',
            collapsed: ['right']
          }}
          bulk={({ selected, clear }) => (
            <>
              <Button size="sm" icon="target">
                Change target
              </Button>
              <Button size="sm" icon="sparkle">
                Draft fixes
              </Button>
              <Button size="sm" icon="check" onClick={clear}>
                Keep {selected.length} as is
              </Button>
            </>
          )}
          rowMenu={todoMenu}
          onActivate={(row) => setOpened(`Q${row.n}`)}
          isRowCurrent={(row) => opened === `Q${row.n}`}
          initialSort={[{ key: 'odds', dir: 'desc' }]}
          pageSize={10}
          summary={(info) => `${info.matching} questions with an AI Overview · 17 to do`}
          empty={<EmptyState icon="inbox" title="No questions yet" />}
        />
        <p className="gl-help" role="status">
          {opened
            ? `Opened ${opened} (row activation opens its drill).`
            : 'Click a row or press Enter on it.'}
        </p>
        <ListGrid<KeywordRow>
          label="Keywords"
          noun={['keyword', 'keywords']}
          rows={keywords}
          rowKey={(row) => row.id}
          rowLabel={(row) => row.keyword}
          columns={KEYWORD_COLUMNS}
          search={{ text: (row) => row.keyword }}
          toolbar={<Chip tone="fox">3 near-duplicate pairs</Chip>}
          ai={AI}
          group={{
            key: (row) => ({ key: row.group, label: row.group }),
            meta: (rows) => {
              const first = rows[0]
              return first ? `${first.groupKind} · ${first.intent} · ${first.funnel}` : ''
            }
          }}
          bulk={() => <Button size="sm">Move to group</Button>}
          rowMenu={() => [
            { id: 'edit', label: 'Edit keyword', icon: 'pencil', onSelect: () => undefined },
            {
              id: 'move',
              label: 'Move to another group',
              icon: 'layers',
              onSelect: () => undefined
            },
            {
              id: 'variants',
              label: 'Suggest variants',
              icon: 'sparkle',
              tone: 'ai',
              hint: '8 s',
              onSelect: () => undefined
            },
            {
              id: 'remove',
              label: 'Remove',
              icon: 'trash',
              tone: 'danger',
              onSelect: () => undefined
            }
          ]}
          initialSort={[{ key: 'keyword', dir: 'asc' }]}
          maxBodyHeight={440}
          summary={(info) => `${info.matching} keywords in ${info.groups} groups`}
          empty={<EmptyState icon="inbox" title="No keywords yet" />}
        />
        <div className="gl-empty-pair">
          <div className="gl-empty-card">
            <EmptyState
              icon="search"
              title="No keywords match “pager alternative”"
              action={<Button size="sm">Clear search</Button>}
            />
          </div>
          <div className="gl-empty-card">
            <EmptyState
              icon="inbox"
              title="No AI Overview yet"
              body="CiteFox checks these again on Nov 2."
              action={<Button size="sm">Check now</Button>}
            />
          </div>
        </div>
      </div>
    </GallerySection>
  )
}
