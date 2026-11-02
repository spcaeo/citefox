import { useContext, type JSX } from 'react'
import type { PlatformRole } from '@shared/site-role'
import { copyText } from '../../../components/clipboard'
import { DrillButton, safeExternalUrl, type PromptDrill } from '../../../drill'
import { DrillContext } from '../../../drill/context'
import { displayUrl } from '../../../m3/model'
import { Chip, EmptyState, ListGrid, UrlText, type ListColumn, type MenuItem } from '../../../ui'
import type { SourceActions } from '../../../sites/useSourceActions'
import {
  citedLabel,
  relationLabel,
  siteTypeLabel,
  sourceSummary,
  type SourceLine
} from '../../../sites/sources'
import { Card } from '../OverviewCards'
import { TypeCell, WhoCell } from '../../../sites/SourceCells'

/** What opening a platform's page opens. */
const OPEN_LABEL: Readonly<Record<PlatformRole, string>> = {
  community: 'Open the thread',
  qa: 'Open the thread',
  social: 'Open post',
  video: 'Open video',
  encyclopedia: 'Open article',
  review: 'Open listing',
  media: 'Open article'
}

/**
 * The sources an answer listed, in its order, as one card (FR-13.2): what kind of
 * site each one is, who it is to you, and how often the answer's text links to it.
 * A neutral site can be marked as a competitor right in its row; a known platform
 * (Reddit, YouTube, G2) never is, it opens as what it is. Type and who it is open a
 * menu to set them for the project. An own page that is not tracked can be tracked,
 * and in a topic made its target page.
 */
export function SourcesCard({
  headingId,
  title,
  gridLabel,
  engine,
  lines,
  topic,
  actions,
  domainDrill,
  highlight = null
}: {
  headingId: string
  /** "Sources Google listed". */
  title: string
  /** The grid's accessible name. */
  gridLabel: string
  /** Whose order the sources are in, such as "Google" or "ChatGPT". */
  engine: string
  lines: readonly SourceLine[]
  /** The prompt is a topic's: its target is the topic's target page. */
  topic: boolean
  actions: SourceActions
  /** The overviews in this check that cite a domain. Null for a domain with none. */
  domainDrill?: (domain: string) => PromptDrill | null
  /** A source position to mark, such as the one a gap fact points at. */
  highlight?: number | null
}): JSX.Element {
  // Drills need the screen's DrillHost; an engine's sources outside one have none.
  const drills = useContext(DrillContext)
  const drillFor = (line: SourceLine): PromptDrill | null =>
    drills === null || line.relation.kind === 'target' ? null : (domainDrill?.(line.domain) ?? null)

  const columns: readonly ListColumn<SourceLine>[] = [
    {
      id: 'position',
      label: '#',
      hint: `${engine}'s order: 1 = shown first`,
      width: 56,
      numeric: true,
      sort: (line) => line.position,
      render: (line) => (
        <>
          <span className="sr-only">Number </span>
          {line.position}
        </>
      )
    },
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 260,
      wrap: true,
      sort: (line) => line.title ?? line.domain,
      render: (line) => <PageCell line={line} drill={drillFor(line)} />
    },
    {
      id: 'type',
      label: 'Type of site',
      width: 196,
      sort: (line) => siteTypeLabel(line),
      render: (line) => <TypeCell line={line} actions={actions} />
    },
    {
      id: 'who',
      label: 'Who it is',
      width: 264,
      sort: (line) => relationLabel(line.relation, topic),
      render: (line) => <WhoCell line={line} topic={topic} actions={actions} />
    },
    {
      id: 'cited',
      label: 'Cited in the answer',
      hint: `How many times ${engine}'s answer text links to the page. Listed only: it is in the sources but not linked from the text.`,
      width: 152,
      numeric: true,
      sort: (line) => line.cited,
      render: (line) => (
        <span className={line.cited ? undefined : 'pd2-faint'}>{citedLabel(line.cited)}</span>
      )
    }
  ]

  function menu(line: SourceLine): MenuItem[] {
    const href = safeExternalUrl(line.url)
    const drill = drillFor(line)
    const { relation } = line
    const quick: MenuItem[] = []
    if (relation.kind === 'neutral' && actions.markCompetitor) {
      quick.push({
        id: 'competitor',
        label: 'Mark as competitor',
        icon: 'plus',
        disabled: actions.saving !== null,
        onSelect: () => actions.markCompetitor?.(line)
      })
    }
    if (relation.kind === 'own' && !relation.tracked) {
      quick.push({
        id: 'track',
        label: 'Track this page',
        icon: 'plus',
        onSelect: () => actions.trackPage(line)
      })
    }
    if (relation.kind === 'own' && actions.setTarget) {
      quick.push({
        id: 'target',
        label: 'Set as target page',
        icon: 'target',
        onSelect: () => actions.setTarget?.(line)
      })
    }
    const rest: MenuItem[] = [
      ...(href
        ? [
            {
              id: 'open',
              label: relation.kind === 'platform' ? OPEN_LABEL[relation.role] : 'Open page',
              icon: 'external' as const,
              onSelect: () => window.open(href, '_blank', 'noopener,noreferrer')
            }
          ]
        : []),
      {
        id: 'copy',
        label: 'Copy URL',
        icon: 'copy',
        onSelect: () => void copyText(line.url)
      },
      ...(drill
        ? [
            {
              id: 'cites',
              label: `Every overview citing ${line.domain}`,
              icon: 'eye' as const,
              onSelect: () => drills?.open(drill)
            }
          ]
        : [])
    ]
    const [first, ...others] = rest
    return first ? [...quick, { ...first, groupStart: quick.length > 0 }, ...others] : quick
  }

  return (
    <Card headingId={headingId} title={title} className="pd2-grid-card">
      {lines.length > 0 ? (
        <ul className="pd2-src-summary" aria-label="In these sources">
          {sourceSummary(lines).map((text) => (
            <li key={text}>
              <Chip size="sm">{text}</Chip>
            </li>
          ))}
        </ul>
      ) : null}
      {actions.error ? (
        <p className="pd2-src-error" role="alert">
          {actions.error}
        </p>
      ) : null}
      <ListGrid<SourceLine>
        label={gridLabel}
        noun={['source', 'sources']}
        rows={lines}
        rowKey={(line) => line.key}
        rowLabel={(line) => `source ${line.position}`}
        columns={columns}
        narrowDrops={['cited', 'type']}
        initialSort={[{ key: 'position', dir: 'asc' }]}
        rowMenu={menu}
        isRowCurrent={(line) => line.position === highlight}
        pageSize="all"
        // At most 20 sources: the card grows to show them all, with no scroll of its own.
        virtualize={false}
        footer="paged"
        empty={<EmptyState compact title="No sources were listed" />}
      />
    </Card>
  )
}

/** The page's icon and title, its address under it, with Copy and Open at the end. */
function PageCell({ line, drill }: { line: SourceLine; drill: PromptDrill | null }): JSX.Element {
  const href = safeExternalUrl(line.url)
  const name = line.title ?? line.domain
  const text = (
    <span className="pd2-src-page">
      {drill ? (
        <DrillButton
          drill={drill}
          untracked
          className="pd2-cell-btn pd2-src-title"
          label={`${name}: every overview in this check that cites ${line.domain}`}
        >
          {name}
        </DrillButton>
      ) : (
        <span className="pd2-src-title">{name}</span>
      )}
      <span className="pd2-src-url mono">{displayUrl(line.url)}</span>
    </span>
  )
  return href ? (
    <UrlText url={href} label={name} className="pd2-src-cell">
      {text}
    </UrlText>
  ) : (
    text
  )
}
