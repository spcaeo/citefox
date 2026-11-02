import type { JSX } from 'react'
import { addStartHash } from '../../../shell/routes'
import { Panel } from '../../../ui'
import type { ExportMarkets } from '../hooks/useExportMarkets'
import { ALL_MARKETS, countLabel, type ExportForm, type ExportWindow } from '../model'
import { ChoiceGroup } from './ChoiceGroup'
import { ExportScopeField, type ExportScopeFieldProps } from './ExportScopeField'

const WINDOW_HINTS: Record<ExportWindow, string> = {
  latest: 'The latest full check in each market.',
  all: 'Every check stored for this scope.',
  range: 'Checks that finished between these dates, inclusive.'
}

/** Up to this many market choices (All plus each market) show as a segmented control. */
const SEG_MARKETS = 4

/** Scope, markets and data window: the first panel of the export rail. */
export function IncludeCard({
  form,
  onPatch,
  pages,
  pageId,
  onPage,
  markets,
  hasProject,
  scope
}: {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
  pages: readonly { id: string; label: string; kind?: 'page' | 'topic' }[]
  pageId: string | null
  onPage: (pageId: string) => void
  markets: ExportMarkets
  /** Offers "Add a page" when a project is open but has no pages. */
  hasProject: boolean
  /** The scope pickers' data: pages, groups, clusters, topics and saved views. */
  scope: Omit<ExportScopeFieldProps, 'form' | 'onPatch' | 'pages' | 'pageId' | 'onPage'>
}): JSX.Element {
  const marketChoices = [
    {
      value: ALL_MARKETS,
      label: 'All markets',
      hint: countLabel(markets.markets.length, 'market')
    },
    ...markets.markets.map((market) => ({ value: market.id, label: market.label }))
  ]
  return (
    <Panel title="What to include" className="xpt-panel">
      <div className="xpt-fields">
        {pages.length === 0 && form.scope === 'page' ? (
          <p className="xpt-help">
            No pages yet.
            {hasProject ? (
              <>
                {' '}
                <a href={addStartHash()}>Set up your site</a>
              </>
            ) : null}
          </p>
        ) : null}
        <ExportScopeField
          form={form}
          onPatch={onPatch}
          pages={pages}
          pageId={pageId}
          onPage={onPage}
          hasProject={hasProject}
          {...scope}
        />

        {markets.error !== null ? (
          <p className="xpt-warn" role="alert">
            Could not load this page&apos;s markets, so only the default market is listed.{' '}
            {markets.error}{' '}
            <button type="button" className="linkbtn" onClick={markets.retry}>
              Try again
            </button>
          </p>
        ) : null}
        {markets.markets.length === 0 ? (
          <div className="xpt-field">
            <span className="xpt-label">Markets</span>
            <p className="xpt-help">No markets yet.</p>
          </div>
        ) : markets.markets.length === 1 ? (
          <div className="xpt-field">
            <span className="xpt-label">Market</span>
            <span>{markets.markets[0]?.label}</span>
            <span className="xpt-help">The only market tracked here.</span>
          </div>
        ) : (
          <ChoiceGroup
            name="market"
            legend="Markets"
            variant={marketChoices.length <= SEG_MARKETS ? 'seg' : 'list'}
            value={markets.choice}
            onChange={markets.setChoice}
            choices={marketChoices}
          />
        )}

        <div className="xpt-field">
          <ChoiceGroup
            name="window"
            legend="Data window"
            variant="seg"
            value={form.checks}
            onChange={(checks) => onPatch({ checks })}
            choices={[
              { value: 'latest', label: 'Latest check', hint: WINDOW_HINTS.latest },
              { value: 'all', label: 'Every check', hint: WINDOW_HINTS.all },
              { value: 'range', label: 'Date range', hint: WINDOW_HINTS.range }
            ]}
          />
          {form.checks === 'range' ? (
            <div className="xpt-dates">
              <div className="xpt-field">
                <label className="xpt-label" htmlFor="d-from">
                  From
                </label>
                <input
                  id="d-from"
                  className="ui-input"
                  type="date"
                  value={form.from}
                  max={form.to || undefined}
                  onChange={(event) => onPatch({ from: event.target.value })}
                />
              </div>
              <div className="xpt-field">
                <label className="xpt-label" htmlFor="d-to">
                  To
                </label>
                <input
                  id="d-to"
                  className="ui-input"
                  type="date"
                  value={form.to}
                  min={form.from || undefined}
                  onChange={(event) => onPatch({ to: event.target.value })}
                />
              </div>
            </div>
          ) : null}
          <p className="xpt-help">Trends always use every check in the window.</p>
        </div>
      </div>
    </Panel>
  )
}
