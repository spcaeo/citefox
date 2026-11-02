import type { JSX } from 'react'
import type { Market, PageResults } from '@shared/domain'
import { pluralize, pluralWord } from '@shared/pluralize'
import { DrillNumber, DrillPopover, safeExternalUrl } from '../../drill'
import type { PageChrome } from '../../projects/chrome'
import { marketLabel } from '../../shell/model'
import { pageHash, readHash, runningHash } from '../../shell/routes'
import { UrlText } from '../../ui'
import { Sep } from '../bits'
import { formatDay, formatStamp, freshnessLine } from '../model'
import { promptSetVersionLabel } from '../promptSetVersion'
import type { ResultsDrills } from './drills'

/**
 * "What this report covers" as one line above the KPI row: the prompts, the
 * market shown, the check and whether it is fresh. The rest (brands, target
 * page, build time, prompt set) sits behind "About this check". Each value
 * opens what it describes.
 */
export function ScopeCard({
  pageId,
  page,
  market,
  results,
  drills
}: {
  pageId: string
  page: PageChrome
  market: Market | undefined
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const checked = drills.get('funnel:checked')
  const { scope } = results
  return (
    <section className="m3-scope-strip" aria-labelledby="m3-scope-h">
      <h2 id="m3-scope-h" className="sr-only">
        What this report covers
      </h2>
      <p className="m3-scope">
        <span>
          {checked && checked.rows.length === scope.promptCount ? (
            <DrillNumber
              drill={checked}
              className="num"
              label={`${scope.promptCount} buyer questions: see them all`}
            />
          ) : (
            <span className="num">{scope.promptCount.toLocaleString('en-US')}</span>
          )}{' '}
          {pluralWord(scope.promptCount, 'buyer question')}
        </span>
        <Sep />
        <span>
          {market ? <>{marketLabel(market)} of </> : null}
          <a
            className="num"
            href={pageHash(pageId, 'markets')}
            aria-label={`${pluralize(scope.marketCount, 'market')}: compare them on the Markets tab`}
          >
            {pluralize(scope.marketCount, 'market')}
          </a>
        </span>
        <Sep />
        <span className="num">
          {scope.checkedAt ? (
            <>
              Checked{' '}
              <a
                href={pageHash(pageId, 'history')}
                aria-label={`Check on ${formatStamp(scope.checkedAt)}: open History`}
              >
                {formatStamp(scope.checkedAt)}
              </a>
            </>
          ) : (
            'No check yet'
          )}
        </span>
        {scope.checkedAt ? (
          <>
            <Sep />
            {scope.stale ? (
              <span className="m3-scope-fresh">
                <span className="m3-down">{freshnessLine(results)}</span>{' '}
                <a href={runningHash(pageId)} className="m3-fresh-act">
                  Check now
                </a>
              </span>
            ) : (
              <span className="m3-ok">Up to date</span>
            )}
          </>
        ) : null}
        <span className="m3-scope-about">
          <DrillPopover
            label="About this check"
            title="About this check"
            className="m3-scope-about-btn"
            content={() => (
              <ScopeDetails pageId={pageId} page={page} results={results} drills={drills} />
            )}
          >
            About this check
          </DrillPopover>
        </span>
      </p>
    </section>
  )
}

/** The popover behind "About this check": every scope fact, each opening what it describes. */
function ScopeDetails({
  pageId,
  page,
  results,
  drills
}: {
  pageId: string
  page: PageChrome
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const named = drills.get('named')
  const { scope } = results
  const pageUrl = safeExternalUrl(scope.pageUrl)
  return (
    <div className="m3-scope-pop">
      <dl className="m3-scope-facts">
        <div>
          <dt>Brands looked for</dt>
          <dd>
            {scope.brands.join(', ')}
            {named && results.run ? (
              <>
                <Sep />
                named in{' '}
                <DrillNumber drill={named} label={`Named in ${named.rows.length} AI Overviews`} />
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Target page</dt>
          <dd>
            {pageUrl ? <UrlText url={pageUrl} label={page.displayUrl} /> : page.displayUrl}{' '}
            <a href={readHash(pageId)} aria-label={`${page.displayUrl}: see what CiteFox read`}>
              What CiteFox read
            </a>
          </dd>
        </div>
        <div>
          <dt>Data from check on</dt>
          <dd className="num">{formatStamp(scope.checkedAt)}</dd>
        </div>
        <div>
          <dt>Built</dt>
          <dd className="num">{formatStamp(scope.builtAt)}</dd>
        </div>
        <div>
          <dt>Question set</dt>
          <dd>
            <a href={pageHash(pageId, 'prompts')}>
              {promptSetVersionLabel(scope.promptSetVersion)}
            </a>
            {scope.promptSetSavedAt ? (
              <>
                <Sep />
                saved {formatDay(scope.promptSetSavedAt)}
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="m3-scope-note">
        {freshnessLine(results)}. A warning shows when the latest check is more than 7 days old.
        Times are your local time.
      </p>
    </div>
  )
}
