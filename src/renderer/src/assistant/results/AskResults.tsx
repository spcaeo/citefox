import { useMemo, type JSX } from 'react'
import type { PromptCheckStatus } from '@shared/domain'
import type { AskRow } from '@shared/ipc'
import { DrillButton, DrillLink, DrillNumber, openTarget } from '../../drill'
import { Movement } from '../../m3/bits'
import { statusLabel } from '../../m3/model'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { Chip, ListGrid, UrlText, type ChipTone, type ListColumn } from '../../ui'
import {
  askChecksDrill,
  askDomainDrill,
  askMarketsDrill,
  askPagesDrill,
  rowPageTarget,
  rowPromptTarget,
  type AskProject
} from './drills'
import { checkedDay, positionText } from './format'
import './results.css'

/**
 * The answer's counts: matching prompt checks, pages and markets. Each opens
 * exactly the rows behind it.
 */
export function AskCounts({
  rows,
  total,
  projectId = null
}: {
  rows: readonly AskRow[]
  total: number
  /** The project the answer was asked in; its links open there. */
  projectId?: AskProject
}): JSX.Element | null {
  if (rows.length === 0) return null
  const checks = askChecksDrill(rows, total, projectId)
  const pages = askPagesDrill(rows, projectId)
  const markets = askMarketsDrill(rows, projectId)
  return (
    <div className="ask-counts">
      <p className="ask-counts-line num">
        <DrillNumber
          drill={checks}
          label={`${rows.length} ${rows.length === 1 ? 'question check matches' : 'question checks match'} these filters`}
          suffix={rows.length === 1 ? ' question check' : ' question checks'}
        />
        {total > rows.length ? ` of ${total.toLocaleString('en-US')}` : ''} on{' '}
        <DrillNumber
          drill={pages}
          label={`${pages.items.length} ${pages.items.length === 1 ? 'page' : 'pages'} in this answer`}
          suffix={pages.items.length === 1 ? ' page' : ' pages'}
        />{' '}
        in{' '}
        <DrillNumber
          drill={markets}
          label={`${markets.items.length} ${markets.items.length === 1 ? 'market' : 'markets'} in this answer`}
          suffix={markets.items.length === 1 ? ' market' : ' markets'}
        />
      </p>
      <DrillButton drill={checks} untracked className="ui-btn ui-btn-secondary ui-btn-sm">
        Show in CiteFox
      </DrillButton>
    </div>
  )
}

/** v2 chip tone per status: fox only when your page is cited. */
function statusTone(status: PromptCheckStatus): ChipTone {
  switch (status) {
    case 'page_cited':
      return 'fox'
    case 'other_own_page':
      return 'info'
    case 'brand_mentioned':
      return 'ok'
    case 'error':
      return 'bad'
    case 'not_cited':
    case 'no_aio':
      return 'neutral'
  }
}

const STATUS_ORDER: readonly PromptCheckStatus[] = [
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited',
  'no_aio',
  'error'
]

function rowKey(row: AskRow): string {
  return `${row.pageId}|${row.marketId}|${row.promptId}`
}

function columns(rows: readonly AskRow[], projectId: AskProject): ListColumn<AskRow>[] {
  return [
    {
      id: 'page',
      label: 'Page',
      width: 120,
      sort: (row) => row.pageLabel.toLowerCase(),
      render: (row) => (
        <DrillLink target={rowPageTarget(row, projectId)} className="ask-clip">
          <span title={row.pageUrl ?? row.pageLabel}>{row.pageLabel}</span>
        </DrillLink>
      )
    },
    {
      id: 'market',
      label: 'Market',
      width: 72,
      sort: (row) => row.marketLabel,
      render: (row) => row.marketLabel
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 150,
      sort: (row) => row.promptText.toLowerCase(),
      render: (row) => (
        <DrillLink target={rowPromptTarget(row, projectId)} className="ask-clip">
          {row.promptText}
        </DrillLink>
      )
    },
    {
      id: 'status',
      label: 'Status',
      width: 124,
      sort: (row) => STATUS_ORDER.indexOf(row.status),
      render: (row) => (
        <Chip size="sm" tone={statusTone(row.status)} dot={row.status === 'page_cited'}>
          {statusLabel(row.status)}
        </Chip>
      )
    },
    {
      id: 'position',
      label: 'Position',
      width: 68,
      numeric: true,
      sort: (row) => row.position,
      cellClassName: 'ask-position',
      render: (row) => positionText(row.position)
    },
    {
      id: 'change',
      label: 'Change',
      width: 92,
      render: (row) => <Movement movement={row.movement} />
    },
    {
      id: 'domains',
      label: 'Cited domains',
      width: 150,
      render: (row) =>
        row.citedDomains.length === 0 ? (
          <span className="ask-faint">None</span>
        ) : (
          <span className="ask-clip">
            {row.citedDomains.map((domain, at) => (
              <span key={domain}>
                {at > 0 ? ', ' : ''}
                <UrlText domain={domain} icon={false}>
                  <DrillButton
                    drill={askDomainDrill(rows, domain, projectId)}
                    untracked
                    label={`Matching question checks citing ${domain}`}
                  >
                    <SiteIcon domain={domain} spaced />
                    {domain}
                  </DrillButton>
                </UrlText>
              </span>
            ))}
          </span>
        )
    },
    {
      id: 'checked',
      label: 'Checked',
      width: 84,
      sort: (row) => row.checkedAt,
      render: (row) => checkedDay(row.checkedAt)
    }
  ]
}

/**
 * The matched prompt checks as the v2 list grid. A row opens Prompt detail in
 * its market; the page opens its Results in that market; a cited domain opens
 * the matching checks that cite it.
 */
export function AskResults({
  rows,
  total,
  projectId = null
}: {
  rows: readonly AskRow[]
  total: number
  /** The project the answer was asked in; its links open there. */
  projectId?: AskProject
}): JSX.Element | null {
  const cols = useMemo(() => columns(rows, projectId), [rows, projectId])
  if (rows.length === 0) return null
  return (
    <ListGrid
      label="Matching question checks"
      noun={['question check', 'question checks']}
      rows={rows}
      rowKey={rowKey}
      rowLabel={(row) => row.promptText}
      columns={cols}
      search={{
        text: (row) =>
          [row.promptText, row.pageLabel, row.marketLabel, ...row.citedDomains].join(' ')
      }}
      onActivate={(row) => openTarget(rowPromptTarget(row, projectId))}
      summary={(info) =>
        rows.length < total
          ? `The first ${rows.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} matching question checks`
          : `${info.matching.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} matching question checks`
      }
      empty={null}
      className="ask-grid"
    />
  )
}
