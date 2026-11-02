import { useId, useState, type JSX } from 'react'
import type {
  ImportCandidate,
  ImportCandidateList,
  ImportRow,
  ParseImportUrlsRequest
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { Icon } from '../../components/Icon'
import { MD_BTN, SM_BTN } from '../buttons'
import { openDrawer } from '../../shell/drawers'
import { pagesHash, sectionHash } from '../../shell/routes'
import type { StructureClient } from '../../structure/client'
import { errorMessage } from '../hooks/useImportCandidates'
import { fileRowsCsv } from '../utils/selection'
import type { ImportSource, ParseOutcome } from '../types'
import { StepHead } from './StepHead'

/** Rejected lines listed before "Show all". */
const REJECTS_FIRST = 20

const SOURCES: readonly { id: ImportSource; label: string }[] = [
  { id: 'sitemap', label: 'Sitemap' },
  { id: 'paste', label: 'Paste URLs' },
  { id: 'file', label: 'CSV or Excel file' }
]

export function SourceStep({
  client,
  projectId,
  domain,
  list,
  onSitemapRead,
  onPasted
}: {
  client: StructureClient
  projectId: string
  domain: string
  list: ImportCandidateList | null
  onSitemapRead: () => Promise<void>
  onPasted: (rows: readonly ImportCandidate[]) => number
}): JSX.Element {
  const urlId = useId()
  const pasteId = useId()
  const [source, setSource] = useState<ImportSource>('sitemap')
  const [sitemapUrl, setSitemapUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ParseOutcome | null>(null)

  async function readSitemap(): Promise<void> {
    setBusy(true)
    setError(null)
    setReadNote(null)
    try {
      const report = await client['sitemaps:discover']({
        projectId,
        url: sitemapUrl.trim() || null
      })
      await onSitemapRead()
      setReadNote(
        report.problems.length > 0
          ? report.problems.join(' ')
          : `Read ${pluralize(report.sitemapsRead, 'sitemap')}: ${pluralize(report.pageCount, 'page')}.`
      )
    } catch (cause) {
      setError(errorMessage(cause, 'Could not read that sitemap.'))
    } finally {
      setBusy(false)
    }
  }

  async function parse(text: string, format: ParseImportUrlsRequest['format']): Promise<void> {
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      const parsed = await client['import:parseUrls']({ projectId, text, format })
      const added = onPasted(parsed.rows)
      setOutcome({ rejected: parsed.rejected, duplicates: parsed.duplicates, added })
    } catch (cause) {
      setError(errorMessage(cause, 'Could not read those URLs.'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Import a file, stacked over this screen: pick, drop or paste a CSV or Excel
   * file, match its columns (the URL column need not be named url) and check
   * every row. The checked addresses come back and join the selection.
   */
  function importFile(): void {
    openDrawer(
      'import',
      { 'import.entity': 'pages' },
      {
        onResult: (rows) => {
          if (!Array.isArray(rows)) return
          // The Label column comes along, so the pages keep the names the file gave them.
          const picked = (rows as ImportRow[])
            .map((row) => ({
              url: (row.values.url ?? '').trim(),
              label: (row.values.label ?? '').trim()
            }))
            .filter((row) => row.url.length > 0)
          if (picked.length > 0) void parse(fileRowsCsv(picked), 'csv')
        }
      }
    )
  }

  const skipped = list?.skippedSitemaps ?? []
  return (
    <section className="imp-step imp-card" aria-labelledby="imp-step-1">
      <StepHead
        number={1}
        id="imp-step-1"
        title="Source"
        aside={
          <a className={SM_BTN} href={sectionHash('structure')}>
            Manage sitemaps and sync
          </a>
        }
      >
        Where should CiteFox read your pages from?
      </StepHead>
      <fieldset className="imp-plain">
        <legend className="sr-only">Source</legend>
        <div className="actions">
          {SOURCES.map((item) => (
            <label className="choice" key={item.id}>
              <input
                type="radio"
                name="imp-source"
                checked={source === item.id}
                onChange={() => setSource(item.id)}
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      {source === 'sitemap' ? (
        <div className="field">
          <label htmlFor={urlId}>Sitemap URL</label>
          <div className="imp-inline">
            <input
              id={urlId}
              className="ob-input mono"
              type="url"
              placeholder={`https://${domain}/sitemap.xml`}
              value={sitemapUrl}
              onChange={(event) => setSitemapUrl(event.target.value)}
            />
            <button
              type="button"
              className={MD_BTN}
              disabled={busy}
              onClick={() => void readSitemap()}
            >
              <Icon name="refresh" />
              {busy ? 'Reading…' : 'Read sitemap'}
            </button>
          </div>
          <span className="hint">
            A sitemap index is fine. CiteFox follows every child sitemap it lists. Leave it empty to
            find sitemaps through {domain}/robots.txt.
          </span>
        </div>
      ) : null}
      {source === 'paste' ? (
        <div className="field">
          <label htmlFor={pasteId}>Page URLs</label>
          <textarea
            id={pasteId}
            className="ob-input mono imp-paste"
            rows={6}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <span className="hint">One URL per line. Only {domain} pages are imported.</span>
          <div className="actions">
            <button
              type="button"
              className={MD_BTN}
              disabled={busy || pasteText.trim().length === 0}
              onClick={() => void parse(pasteText, 'lines')}
            >
              Add these URLs
            </button>
          </div>
        </div>
      ) : null}
      {source === 'file' ? (
        <div className="field">
          <div className="actions">
            <button type="button" className={MD_BTN} disabled={busy} onClick={importFile}>
              <Icon name="file" />
              Choose a file…
            </button>
          </div>
          <span className="hint">
            CSV or Excel. You match the columns and check every row before anything joins the
            selection; a template is there too. Only {domain} pages are imported.
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {readNote ? (
        <p className="hint" role="status">
          {readNote}
        </p>
      ) : null}
      {outcome ? <ParseSummary outcome={outcome} /> : null}
      {list ? (
        <p className="imp-found" role="status">
          <span className="imp-label">Found</span>{' '}
          <strong>{list.rows.length.toLocaleString('en-US')}</strong>{' '}
          {list.rows.length === 1 ? 'page' : 'pages'} in {pluralize(list.sitemapCount, 'sitemap')}
          {skipped.length > 0 ? ` (${skipped.join(', ')} left out)` : ''} ·{' '}
          <a href={pagesHash({ view: 'tracked' })}>
            <strong>{list.trackedCount.toLocaleString('en-US')}</strong> already tracked
          </a>
        </p>
      ) : null}
    </section>
  )
}

function ParseSummary({ outcome }: { outcome: ParseOutcome }): JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? outcome.rejected : outcome.rejected.slice(0, REJECTS_FIRST)
  return (
    <div className="imp-parse" role="status">
      <p>
        Added {pluralize(outcome.added, 'page')} to your selection
        {outcome.duplicates > 0
          ? ` · ${pluralize(outcome.duplicates, 'repeated line')} skipped`
          : ''}
        .
      </p>
      {outcome.rejected.length > 0 ? (
        <>
          <p className="muted">{pluralize(outcome.rejected.length, 'line')} not imported:</p>
          <ul className="imp-rejects">
            {shown.map((item) => (
              <li key={`${item.line}-${item.value}`}>
                <span className="mono">Line {item.line}</span>{' '}
                <span className="mono">{item.value}</span> — {item.reason}
              </li>
            ))}
          </ul>
          {outcome.rejected.length > REJECTS_FIRST ? (
            <p className="hint">
              {all ? null : (
                <>And {pluralize(outcome.rejected.length - REJECTS_FIRST, 'more line')}. </>
              )}
              <button
                type="button"
                className={SM_BTN}
                aria-expanded={all}
                onClick={() => setAll((value) => !value)}
              >
                {all
                  ? `Show the first ${REJECTS_FIRST}`
                  : `Show all ${outcome.rejected.length.toLocaleString('en-US')}`}
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
