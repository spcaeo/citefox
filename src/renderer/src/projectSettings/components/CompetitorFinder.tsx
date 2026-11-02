import { useState, type JSX } from 'react'
import { Button, DomainText } from '../../ui'
import type { CompetitorCandidate, CompetitorFindings, Market } from '@shared/domain'
import type { AdminClient } from '../../admin/client'
import { DrillButton, DrillFigure } from '../../drill'
import { competitorDrill } from '../utils/competitorDrill'
import { errorText, plural } from '../utils/model'

/**
 * FR-10.9. Domains AI Overviews cite instead of the project's own, from stored checks.
 * Carrier and help pages are marked as probably not competitors. Add saves at once.
 */
export function CompetitorFinder({
  admin,
  projectId,
  competitors,
  markets,
  brand,
  onAdd
}: {
  admin: AdminClient
  projectId: string
  competitors: readonly string[]
  /** The project's markets, for the drawer's market column. */
  markets: readonly Market[]
  brand: string
  onAdd: (domain: string) => Promise<void>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<CompetitorFindings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  async function run(): Promise<void> {
    setOpen(true)
    setBusy(true)
    setError(null)
    try {
      setFound(await admin.findCompetitors({ projectId }))
    } catch (cause) {
      setError(errorText(cause, 'Could not read the stored checks.'))
    } finally {
      setBusy(false)
    }
  }

  async function add(domain: string): Promise<void> {
    setAdding(domain)
    setError(null)
    try {
      await onAdd(domain)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setAdding(null)
    }
  }

  const listed = (domain: string): boolean =>
    competitors.some((item) => item.toLowerCase() === domain.toLowerCase())

  return (
    <div className="stack-tight">
      <div>
        <Button icon="search" disabled={busy} onClick={() => void run()}>
          Find competitors from AI Overviews
        </Button>
      </div>
      {open ? (
        <div className="ps-found" role="region" aria-label="Competitor suggestions">
          {busy ? <p role="status">Reading the latest checks…</p> : null}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {found && !busy ? (
            <>
              <p className="muted">
                {found.overviewsRead === 0
                  ? 'No AI Overviews are stored for this project yet.'
                  : `Domains most often cited instead of ${found.domain} in the latest checks (${plural(found.overviewsRead, 'overview', 'overviews')} read). Carrier and help pages are marked so you can leave them out.`}
              </p>
              {found.nextStep ? <p className="hint">{found.nextStep}</p> : null}
              {found.candidates.length > 0 ? (
                <ul className="ps-found-list">
                  {found.candidates.map((item) => (
                    <li key={item.domain} className={item.likelyCompetitor ? '' : 'ps-unlikely'}>
                      <span className="ps-found-domain">
                        <DomainText domain={item.domain} />
                      </span>
                      <OverviewCount found={found} item={item} markets={markets} brand={brand} />
                      <span className="faint ps-found-why">{item.reason}</span>
                      {listed(item.domain) ? (
                        <span className="tag">On your list</span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={adding !== null}
                          aria-label={`Add ${item.domain} as a competitor`}
                          onClick={() => void add(item.domain)}
                        >
                          Add
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <div className="actions">
            <Button size="sm" disabled={busy} onClick={() => void run()}>
              Try again
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** "3 overviews": opens the overviews that cited the domain. Plain text from an older engine. */
function OverviewCount({
  found,
  item,
  markets,
  brand
}: {
  found: CompetitorFindings
  item: CompetitorCandidate
  markets: readonly Market[]
  brand: string
}): JSX.Element {
  if (!item.overviewRefs || item.overviewRefs.length !== item.overviews) {
    return <span className="mono faint">{plural(item.overviews, 'overview', 'overviews')}</span>
  }
  const drill = competitorDrill(found, item.domain, { markets, brand, exact: true })
  return (
    <DrillButton
      drill={drill}
      className="drill-num mono faint"
      label={`${plural(drill.items.length, 'overview', 'overviews')} cite ${item.domain}: show them`}
    >
      <DrillFigure drill={drill} /> {drill.items.length === 1 ? 'overview' : 'overviews'}
    </DrillButton>
  )
}
