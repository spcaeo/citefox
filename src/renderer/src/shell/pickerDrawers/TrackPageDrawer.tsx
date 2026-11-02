import { useEffect, useState, type JSX } from 'react'
import {
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_MARKET_DEVICE,
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  type Market
} from '@shared/domain'
import type { MarketDraft, ProjectDetail } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { ShellClient } from '../../projects/client'
import { Drawer, DrawerField, DrawerFields, DrawerMain, DrawerSection } from '../../ui'
import { marketLabel } from '../model'
import { readTrackUrl, takeTrackAddress } from './model'
import './pickerDrawers.css'

export interface TrackPageDrawerProps {
  client: ShellClient
  projectId: string
  onClose: () => void
  /** The new page's id: the drawer closes handing it back. */
  onTracked: (pageId: string) => void
}

function draftOf(market: Market): MarketDraft {
  return {
    country: market.country,
    language: market.language,
    location: market.location,
    device: market.device ?? DEFAULT_MARKET_DEVICE,
    localWording: market.localWording
  }
}

/**
 * Track a page (`?drawer=track-page`), opened from any page picker's
 * "+ Track a new page…" or the top bar. The address must be on the project's
 * site; the page joins the project's default market (or every market) and
 * CiteFox sets it up with no searches.
 */
export function TrackPageDrawer({
  client,
  projectId,
  onClose,
  onTracked
}: TrackPageDrawerProps): JSX.Element {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [address, setAddress] = useState(takeTrackAddress)
  const [label, setLabel] = useState('')
  const [allMarkets, setAllMarkets] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    client.getProject({ projectId }).then(
      (next) => {
        if (!cancelled) setProject(next)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause, 'Could not load the project.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, attempt])

  const read = project
    ? readTrackUrl(address, project.domain, project.includeSubdomains)
    : { url: null, error: null }
  const markets = project
    ? allMarkets && project.markets && project.markets.length > 0
      ? project.markets
      : project.defaultMarket
        ? [project.defaultMarket]
        : []
    : []

  async function track(): Promise<void> {
    setTried(true)
    if (!project || read.url === null) return
    if (markets.length === 0) {
      setError('Set the project’s default market in Project settings first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const page = await client.addPage({
        projectId,
        url: read.url,
        markets: markets.map(draftOf),
        intervalDays: DEFAULT_INTERVAL_DAYS,
        samples: DEFAULT_SAMPLE_COUNT,
        promptCount: DEFAULT_PROMPT_COUNT
      })
      if (label.trim()) {
        await client.updatePage({ projectId, pageId: page.id, label: label.trim() })
      }
      onTracked(page.id)
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not track that page.'))
      setBusy(false)
    }
  }

  const otherMarkets = (project?.markets?.length ?? 0) - 1

  return (
    <Drawer
      id="track-page"
      title="Track a page"
      subtitle={project ? `A page on ${project.domain}` : 'A page on your site'}
      testId="track-page-drawer"
      dirty={address.trim().length > 0 && !busy}
      busy={busy}
      closeDisabled={busy}
      loading={project === null && loadError === null}
      {...(loadError
        ? {
            error: {
              message: loadError,
              onRetry: () => {
                setLoadError(null)
                setAttempt((count) => count + 1)
              }
            }
          }
        : {})}
      onClose={onClose}
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : (
          'CiteFox reads the page and drafts its profile, questions and gaps · no searches'
        ),
        primary: {
          label: 'Track page',
          busy,
          disabled: busy || project === null,
          onClick: () => void track()
        }
      }}
    >
      <DrawerMain>
        <DrawerSection title="The page">
          <DrawerFields>
            <DrawerField
              label="Address"
              hint={
                project
                  ? `A path such as /pricing, or a full address on ${project.domain}.`
                  : undefined
              }
              error={tried || address.trim().length > 0 ? read.error : null}
            >
              {(ids) => (
                <input
                  id={ids.id}
                  aria-describedby={ids.describedBy}
                  className="ui-input mono"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="/pricing"
                  value={address}
                  data-autofocus
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void track()
                    }
                  }}
                />
              )}
            </DrawerField>
            <DrawerField label="Label (optional)" hint="A short name for lists. Default: the path.">
              {(ids) => (
                <input
                  id={ids.id}
                  aria-describedby={ids.describedBy}
                  className="ui-input"
                  maxLength={80}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              )}
            </DrawerField>
          </DrawerFields>
        </DrawerSection>
        <DrawerSection
          title="Markets"
          description="Where its AI Overviews are checked. Change them later on the page."
        >
          <p className="ui-drawer-hint">
            {project?.defaultMarket
              ? markets.map((market) => marketLabel(market)).join(', ')
              : 'No default market yet.'}
          </p>
          {otherMarkets > 0 ? (
            <label className="pd-check">
              <input
                type="checkbox"
                checked={allMarkets}
                onChange={(event) => setAllMarkets(event.target.checked)}
              />
              <span>Every project market ({otherMarkets} more than the default)</span>
            </label>
          ) : null}
        </DrawerSection>
      </DrawerMain>
    </Drawer>
  )
}
