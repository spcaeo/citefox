import { useId, useMemo, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { UrlCombobox } from '../../projects/UrlCombobox'
import { pageHash, sectionHash } from '../../shell/routes'
import type { ScopeOptions } from '../../scope'
import { DrawerField, DrawerFields, DrawerSection, UrlText } from '../../ui'
import {
  checkedAddress,
  otherSite,
  pastedAddresses,
  trackedMatch,
  type AddPageState
} from '../model'
import type { CheckNowSource } from '../../checkNow/source'

export interface PageSectionProps {
  state: AddPageState
  options: ScopeOptions
  source: CheckNowSource
  disabled: boolean
  error: string | null
  onChange: (patch: Partial<AddPageState>) => void
}

/**
 * The page's address (typed, pasted or picked from the found pages, which
 * say "tracked" in the list) and its label. Under the box: the address as it
 * will be saved, "Already tracked" with a link to the page, a note when the
 * address is on another site, and "Import N pages instead" when several were pasted.
 */
export function PageSection({
  state,
  options,
  source,
  disabled,
  error,
  onChange
}: PageSectionProps): JSX.Element {
  const urlId = useId()
  const hintId = useId()
  const pasted = pastedAddresses(state.url)
  const many = pasted.length > 1
  const checked = many ? null : checkedAddress(state.url, options.domain)
  const url = checked?.url ?? null
  const tracked = url ? trackedMatch(url, options.pages) : null
  const elsewhere = url ? otherSite(url, options.domain) : null
  const suggest = useMemo(
    () => (query: string) =>
      source['start:suggestUrls']({ projectId: options.projectId, query, limit: 8 }),
    [source, options.projectId]
  )

  return (
    <DrawerSection
      title="Page"
      description="Pick a page from your site or paste its public address."
      testId="add-page-page"
    >
      <DrawerFields columns={1}>
        <DrawerField label="Page URL" htmlFor={urlId} wide>
          <UrlCombobox
            id={urlId}
            value={state.url}
            onChange={(next) => onChange({ url: next })}
            placeholder={`Type a path, such as /pricing, or paste a ${options.domain} address`}
            describedBy={hintId}
            suggest={suggest}
          />
        </DrawerField>
      </DrawerFields>
      <div id={hintId} className="adp-status" aria-live="polite">
        {many ? (
          <p className="adp-line" data-testid="add-page-many">
            You pasted {pluralize(pasted.length, 'address', 'addresses')}. A page is added one at a
            time here.{' '}
            <a href={sectionHash('import-pages')}>
              Import {pluralize(pasted.length, 'page')} instead
            </a>
          </p>
        ) : tracked ? (
          <p className="adp-line adp-warn" data-testid="add-page-tracked">
            <span>
              Already tracked as <strong>{tracked.label}</strong>.
            </span>
            <a href={pageHash(tracked.id, 'results')}>Open it</a>
          </p>
        ) : url ? (
          <div className="adp-line">
            <span className="adp-label">Adds</span>
            <UrlText url={url} />
            {elsewhere ? (
              <span className="adp-warn">
                {' '}
                This address is on {elsewhere}, not {options.domain}.
              </span>
            ) : null}
          </div>
        ) : (
          <p className="adp-line adp-faint">
            Other {options.domain} links count as another page of this project.
          </p>
        )}
        {error ? (
          <p className="adp-line adp-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <DrawerFields columns={1}>
        <DrawerField label="Label" hint="Optional. Shown instead of the page title in lists.">
          {(ids) => (
            <input
              id={ids.id}
              aria-describedby={ids.describedBy}
              className="ui-input"
              type="text"
              value={state.label}
              maxLength={120}
              disabled={disabled}
              placeholder="Such as Pricing page"
              onChange={(event) => onChange({ label: event.target.value })}
            />
          )}
        </DrawerField>
      </DrawerFields>
    </DrawerSection>
  )
}
