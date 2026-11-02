import { useMemo, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import {
  ItemPicker,
  ScopeChooser,
  type PickerItem,
  type ScopeKind,
  type ScopeOptions
} from '../../../scope'
import type { ExportForm, ExportScopeChoice } from '../model'

/** Until the pickers load (or when they cannot): This page and Whole project only. */
const NO_OPTIONS: ScopeOptions = {
  projectId: '',
  domain: '',
  pages: [],
  groups: [],
  clusters: [],
  topics: [],
  views: [],
  markets: [],
  defaultMarketId: null,
  searchesLeft: null
}

/** The scope kinds after "This page", in the order the export lists them. */
const KINDS: readonly ScopeKind[] = ['pages', 'group', 'cluster', 'topic', 'view', 'project']

export interface ExportScopeFieldProps {
  form: ExportForm
  onPatch: (partial: Partial<ExportForm>) => void
  /** The working pages and topics "This page" picks from. */
  pages: readonly { id: string; label: string; kind?: 'page' | 'topic' }[]
  pageId: string | null
  onPage: (pageId: string) => void
  /** Null while the pickers' data loads. */
  options: ScopeOptions | null
  error: string | null
  onRetry: () => void
  /** The pages (and topics) the picked kind covers, for the count line. */
  resolved: readonly string[]
  /** The picker's search, on the URL. */
  query: string
  onQuery: (query: string) => void
  /** False with no project: nothing loads, so no loading line. */
  hasProject?: boolean
}

/**
 * "What to export": This page (searchable, at any size), Pages I pick, A group,
 * A cluster, A topic, A saved view, or the Whole project, through the shared
 * scope chooser. A pick says how many pages it resolves to.
 */
export function ExportScopeField({
  form,
  onPatch,
  pages,
  pageId,
  onPage,
  options,
  error,
  onRetry,
  resolved,
  query,
  onQuery,
  hasProject = true
}: ExportScopeFieldProps): JSX.Element {
  const subjects = useMemo<PickerItem[]>(
    () =>
      pages.map((page) => ({
        id: page.id,
        label: page.label,
        ...(page.kind === 'topic' ? { detail: 'Topic' } : {})
      })),
    [pages]
  )
  const pagePicker = (
    <ItemPicker
      label="This page: pick"
      items={subjects}
      selected={pageId ? [pageId] : []}
      onChange={(ids) => {
        const first = ids[0]
        if (first) onPage(first)
      }}
      single
      noun={['page', 'pages']}
      query={query}
      onQueryChange={onQuery}
      maxHeight={240}
      testId="xpt-page-picker"
    />
  )

  const pickKind = form.scope !== 'page' && form.scope !== 'project'
  return (
    <div className="xpt-field xpt-scope" data-testid="xpt-scope">
      <span className="xpt-label" id="xpt-scope-l">
        What to export
      </span>
      <ScopeChooser
        options={options ?? NO_OPTIONS}
        value={{ kind: form.scope === 'page' ? 'project' : form.scope, ids: form.ids }}
        onChange={(scope) => onPatch({ scope: scope.kind as ExportScopeChoice, ids: scope.ids })}
        kinds={KINDS}
        legend="What to export"
        query={query}
        onQueryChange={onQuery}
        leading={{
          label: 'This page',
          checked: form.scope === 'page',
          onSelect: () => onPatch({ scope: 'page', ids: [] }),
          children: pagePicker
        }}
        testId="xpt-scope-chooser"
      />
      {error !== null ? (
        <p className="xpt-warn" role="alert">
          Could not load the groups, clusters and topics. {error}{' '}
          <button type="button" className="linkbtn" onClick={onRetry}>
            Load them again
          </button>
        </p>
      ) : options === null && hasProject ? (
        <p className="xpt-help">Loading pages, groups and topics…</p>
      ) : null}
      {pickKind ? (
        <p
          className={resolved.length === 0 ? 'xpt-warn' : 'xpt-help'}
          aria-live="polite"
          data-testid="xpt-scope-count"
        >
          {form.ids.length === 0
            ? 'Pick at least one to export.'
            : resolved.length === 0
              ? 'Nothing to export: what you picked has no pages yet.'
              : `${pluralize(resolved.length, form.scope === 'topic' ? 'topic' : 'page')} in this export.`}
        </p>
      ) : null}
    </div>
  )
}
