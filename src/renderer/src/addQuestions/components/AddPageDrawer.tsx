import { useId, useMemo, useState, type JSX } from 'react'
import {
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  type Market
} from '@shared/domain'
import { errorText } from '../../components/errorText'
import { Drawer } from '../../ui'
import { createAddQuestionsSource, type AddQuestionsSource } from '../source'
import { fullUrl, urlProblem } from '../utils/targets'

export interface AddPageDrawerProps {
  projectId: string
  /** What is typed, kept on the URL (`addpage.url`, `addpage.label`). */
  url: string
  label: string
  onChange: (patch: { url?: string; label?: string }) => void
  /** The markets the new page is checked in: the topic's. */
  markets: readonly Market[]
  /** The site's address (`https://example.com`), so a path like `/pricing/` is enough. */
  site: string | null
  onClose: () => void
  /** The new page's full address goes back to Add questions as the page to be cited. */
  onAdded: (url: string) => void
  source?: Pick<AddQuestionsSource, 'pages:add' | 'pages:update'>
}

/**
 * "+ Add a page" over Add questions: the page that should be cited is not
 * tracked yet. It is added in setting up (nothing is read or searched now) and
 * comes back as the default page to be cited.
 */
export function AddPageDrawer({
  projectId,
  url,
  label,
  onChange,
  markets,
  site,
  onClose,
  onAdded,
  source: given
}: AddPageDrawerProps): JSX.Element {
  const source = useMemo(() => given ?? createAddQuestionsSource(), [given])
  const urlId = useId()
  const labelId = useId()
  const hintId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const full = fullUrl(url, site)
  const problem = url.trim() === '' ? null : urlProblem(full, site)

  async function add(): Promise<void> {
    if (full === null || problem !== null || busy) return
    setBusy(true)
    setError(null)
    try {
      const page = await source['pages:add']({
        projectId,
        url: full,
        markets: markets.map((market) => ({
          country: market.country,
          language: market.language,
          location: market.location,
          device: market.device,
          localWording: market.localWording
        })),
        intervalDays: DEFAULT_INTERVAL_DAYS,
        samples: DEFAULT_SAMPLE_COUNT,
        promptCount: DEFAULT_PROMPT_COUNT
      })
      if (label.trim()) {
        await source['pages:update']({ projectId, pageId: page.id, label: label.trim() })
      }
      onAdded(page.url ?? full)
    } catch (cause) {
      setError(errorText(cause, 'Could not add the page.', { sentence: true }))
      setBusy(false)
    }
  }

  return (
    <Drawer
      id="add-page"
      title="Add a page"
      subtitle="A page on your site that should be cited. It is added in setting up; nothing is read or searched now."
      className="aq-page-drawer"
      testId="add-page-drawer"
      dirty={url.trim() !== '' && !busy}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      footer={{
        summary:
          markets.length > 0
            ? `Checked in the topic’s ${markets.length === 1 ? 'market' : `${markets.length} markets`}`
            : null,
        primary: {
          label: 'Add page',
          disabled: full === null || problem !== null || markets.length === 0,
          busy,
          onClick: () => void add(),
          testId: 'add-page-submit'
        }
      }}
    >
      <div className="aq-page-form">
        <div className="aq-field">
          <label className="aq-label" htmlFor={urlId}>
            Page address
          </label>
          <input
            id={urlId}
            className="ui-input aq-mono"
            value={url}
            disabled={busy}
            placeholder={site ? `${site}/pricing/ or /pricing/` : 'https://example.com/pricing/'}
            aria-describedby={hintId}
            aria-invalid={problem !== null || undefined}
            data-autofocus
            onChange={(event) => onChange({ url: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add()
            }}
          />
          <p id={hintId} className={problem ? 'aq-hint aq-hint-bad' : 'aq-hint'}>
            {problem ?? (full ? full : 'A full address, or a path on your site.')}
          </p>
        </div>
        <div className="aq-field">
          <label className="aq-label" htmlFor={labelId}>
            Name (optional)
          </label>
          <input
            id={labelId}
            className="ui-input"
            value={label}
            disabled={busy}
            placeholder="For example: Zapier integration"
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </div>
        {markets.length === 0 ? (
          <p className="aq-hint aq-hint-bad">Pick a topic with a market first.</p>
        ) : null}
        {error ? (
          <p className="aq-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  )
}
