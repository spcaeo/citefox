import { useMemo, useState, type JSX } from 'react'
import type { CompetitorLeaderboardRow, PageResults } from '@shared/domain'
import { Markdown } from '../../components/Markdown'
import { DrillButton, DrillLink, DrillNumber, safeExternalUrl, type PromptDrill } from '../../drill'
import { pageHash, sectionHash } from '../../shell/routes'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { siteColumns } from '../../sites/siteColumns'
import { leaderLine, leaderLines, siteTypeName } from '../../sites/siteRows'
import type { SourceLine } from '../../sites/sources'
import { Button, ListGrid, SectionHead, UrlText, type ListColumn } from '../../ui'
import { Sep, ViewToggle } from '../bits'
import { useCardView } from '../useCardView'
import { TOP_ROWS } from '../constants'
import { percent, showingDomains } from '../model'
import type { ResultsDrills } from './drills'

/**
 * The domain drill under its own NFR-14 id (`cited:<domain>`), so this card's
 * numbers are checked apart from the leaderboard's `domain:<domain>`.
 */
function citedDrill(drills: ResultsDrills, domain: string): PromptDrill | null {
  const drill = drills.get(`domain:${domain}`)
  return drill ? { ...drill, id: `cited:${domain}` } : null
}

/** "Cited instead of you": each domain and its count open the overviews that cite it. */
export function CitedInsteadCard({
  results,
  drills,
  aio
}: {
  results: PageResults
  drills: ResultsDrills
  aio: number
}): JSX.Element {
  const [view, setView] = useCardView('instead')
  const [all, setAll] = useState(false)
  const others = results.leaderboard.filter((row) => row.badge !== 'you')
  const shown = all ? others : others.slice(0, TOP_ROWS)
  const lines = useMemo(() => leaderLines(others), [others])

  return (
    <section className="card stack-tight" aria-labelledby="m3-instead-h">
      <SectionHead
        id="m3-instead-h"
        title="Cited instead of you"
        description={
          <>
            AI Overviews (not links) that cite each domain, out of {aio}
            <Sep />
            {showingDomains(shown.length, others.length)}
          </>
        }
        actions={<ViewToggle view={view} onView={setView} />}
      />
      {view === 'chart' ? (
        shown.map((row) => {
          const drill = citedDrill(drills, row.domain)
          return (
            <div key={row.domain} className="m3-cited">
              {drill ? (
                <UrlText domain={row.domain} icon={false}>
                  <DrillButton drill={drill}>
                    <SiteIcon domain={row.domain} spaced />
                    <span className="mono">{row.domain}</span>
                  </DrillButton>
                </UrlText>
              ) : (
                <UrlText domain={row.domain} variant="url" />
              )}
              <span className="bar">
                <span style={{ width: `${percent(row.aioCount, aio)}%` }} />
              </span>
              {drill ? (
                <DrillNumber drill={drill} className="mono" />
              ) : (
                <span className="mono">{row.aioCount}</span>
              )}
              <TypeLink badge={row.badge} line={leaderLine(lines, row)} />
            </div>
          )
        })
      ) : (
        <CitedTable rows={shown} lines={lines} drills={drills} />
      )}
      {others.length > TOP_ROWS ? (
        <div>
          <Button size="sm" aria-expanded={all} onClick={() => setAll((open) => !open)}>
            {all ? `Show top ${TOP_ROWS}` : `Show all ${others.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * "Your other pages cited instead". A tracked page opens its Results, any
 * other URL opens in the browser, and each prompt opens Prompt detail.
 */
export function CannibalizingCard({
  pageId,
  results,
  drills
}: {
  pageId: string
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  return (
    <section className="card stack-tight" aria-labelledby="m3-cannibal-h">
      <SectionHead
        id="m3-cannibal-h"
        title="Your other pages cited instead"
        description="Own pages Google picked over this one"
      />
      {results.cannibalizing.length === 0 ? <p className="faint">None</p> : null}
      {results.cannibalizing.map((pageRow) => {
        const shownUrl = pageRow.normalizedUrl.replace(/^https?:\/\//, '')
        const external = safeExternalUrl(pageRow.url)
        return (
          <div key={pageRow.normalizedUrl} className="stack-tight">
            <span className="m3-cannibal-url">
              {external ? (
                <UrlText url={external} label={shownUrl} />
              ) : (
                <span className="mono">{shownUrl}</span>
              )}
              {pageRow.pageId ? (
                <a
                  className="m3-link"
                  href={pageHash(pageRow.pageId, 'results')}
                  aria-label={`${shownUrl}: open this tracked page`}
                >
                  Open its results
                </a>
              ) : (
                <span className="faint">Not tracked</span>
              )}
            </span>
            {pageRow.prompts.map((hit) => {
              const prompt = results.prompts.find((row) => row.promptId === hit.promptId)
              if (!prompt) return null
              const target = drills.prompt(prompt)
              return (
                <span key={hit.promptId} className="faint">
                  {target ? (
                    <DrillLink
                      target={target}
                      className="m3-link"
                      label={`Open question ${prompt.promptPosition}: ${prompt.label.split('**').join('')}`}
                    >
                      Question {prompt.promptPosition}
                    </DrillLink>
                  ) : (
                    `Question ${prompt.promptPosition}`
                  )}
                  <Sep />
                  &quot;
                  <Markdown inline baseLevel={3}>
                    {prompt.text}
                  </Markdown>
                  &quot;
                  <Sep />
                  position {hit.position}
                </span>
              )
            })}
          </div>
        )
      })}
      <p className="muted">
        If these pages answer the question better, that&apos;s fine. If this page should own the
        topic, see <a href={pageHash(pageId, 'gaps')}>Content gaps</a>.
      </p>
    </section>
  )
}

/** A site's type that opens Project settings, where competitors are edited. */
function TypeLink({
  badge,
  line
}: {
  badge: CompetitorLeaderboardRow['badge']
  line: SourceLine
}): JSX.Element {
  const label = siteTypeName(line)
  return (
    <a
      className="faint"
      href={sectionHash('project-settings')}
      aria-label={`${label}: ${badge === 'observed' ? 'add it as a competitor' : 'edit competitors'} in Project settings`}
    >
      {label}
    </a>
  )
}

/** "Cited instead of you" as a list grid: each site's name and count open the overviews that cite it. */
function CitedTable({
  rows,
  lines,
  drills
}: {
  rows: readonly CompetitorLeaderboardRow[]
  lines: ReadonlyMap<string, SourceLine>
  drills: ResultsDrills
}): JSX.Element {
  const columns = useMemo<ListColumn<CompetitorLeaderboardRow>[]>(
    () => [
      ...siteColumns<CompetitorLeaderboardRow>({
        site: (row) => ({ domain: row.domain }),
        drill: (row) => citedDrill(drills, row.domain),
        drillLabel: (row) => `${row.domain}: show the questions that cite it`,
        line: (row) => leaderLine(lines, row),
        nameMinWidth: 120,
        websiteWidth: 160,
        typeWidth: 112
      }),
      {
        id: 'overviews',
        label: 'AI Overviews',
        width: 104,
        numeric: true,
        render: (row) => {
          const drill = citedDrill(drills, row.domain)
          return drill ? <DrillNumber drill={drill} /> : row.aioCount
        }
      }
    ],
    [drills, lines]
  )
  return (
    <ListGrid
      label="Domains cited instead of this site. Counts are AI Overviews."
      noun={['domain', 'domains']}
      rows={rows}
      rowKey={(row) => row.domain}
      rowLabel={(row) => row.domain}
      columns={columns}
      pageSize="all"
      className="m3-inner-grid"
      empty={<p className="muted">No other domains were cited.</p>}
    />
  )
}
