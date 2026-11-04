import type { JSX } from 'react'
import {
  PAGE_STATUS_LABELS,
  type PageStory,
  type ReviewReport,
  type StoryTile
} from '@shared/report/review'
import { UrlText } from '../../ui'
import { formatWhen } from '../../utils/dates'
import { useQueryChoice } from '../../utils/queryState'
import { ReportPage } from './copyCells'
import { openReportDetail, siteDetail } from './drill'
import { QuestionTable } from './tables'
import './impact.css'

/**
 * The page drawer (Docs/REPORT-SPEC.md "Page drawer"): one page's before → after story.
 * Delta tiles, the newly / kept / dropped bar, the dates timeline, the position spread,
 * the sites cited beside it, the question tabs, and for a page not cited yet why it waits
 * and what happens next. Opens from any page link in any report.
 */

function Delta({ tile }: { tile: StoryTile }): JSX.Element | null {
  if (tile.delta === null || tile.delta === 0) return null
  const good = tile.lowerIsBetter ? tile.delta < 0 : tile.delta > 0
  const size = Math.abs(tile.delta)
  return (
    <span className={`rv-change rv-change-${good ? 'up' : 'down'}`}>
      {tile.delta > 0 ? '▲' : '▼'} {Number.isInteger(size) ? size : size.toFixed(1)}
    </span>
  )
}

type TabId = 'now' | 'newly' | 'kept' | 'dropped'

const TAB_IDS: readonly TabId[] = ['now', 'newly', 'kept', 'dropped']

const TAB_WORDS: Readonly<Record<TabId, string>> = {
  now: 'Citing it now',
  newly: 'New',
  kept: 'Kept',
  dropped: 'Dropped'
}

export function PageStoryBody({
  report,
  story
}: {
  report: ReviewReport
  story: PageStory
}): JSX.Element {
  const { page } = story
  const comparing = story.tiles[0]?.before !== null
  // The open tab is `?rdt2=` (this page drawer is the second level); the first tab has none.
  const firstTab: TabId =
    story.tabs.now.length === 0 && story.tabs.dropped.length > 0 ? 'dropped' : 'now'
  const [picked, setTab] = useQueryChoice('rdt2', TAB_IDS, firstTab)
  const total = story.split.newly + story.split.kept + story.split.dropped
  const spreadMax = Math.max(1, ...story.spread.map((b) => Math.max(b.now, b.before ?? 0)))
  const tabs: TabId[] = comparing ? ['now', 'newly', 'kept', 'dropped'] : ['now']
  const tab = tabs.includes(picked) ? picked : firstTab
  return (
    <div className="rv-story" data-testid="rv-page-story">
      <div className="rv-dstats">
        <span>
          <ReportPage url={page.url} label={page.path} drill={false} />
        </span>
        <span>
          {page.kind === 'new' ? 'New page' : page.kind === 'rewrite' ? 'Rewrite' : 'Your page'}
        </span>
        {page.daysLive !== null ? <span>{page.daysLive} days live</span> : null}
        <span>
          {page.indexed === null ? 'Index not checked' : page.indexed ? 'Indexed' : 'Not indexed'}
        </span>
        <span>{PAGE_STATUS_LABELS[page.status]}</span>
      </div>

      <div className="rv-tiles rv-tiles-4" aria-label="Before and after">
        {story.tiles.map((tile) => (
          <div key={tile.label} className="rv-tile rv-tile-static">
            <b className="num">
              {tile.now} <Delta tile={tile} />
            </b>
            <small>
              {tile.label}
              {tile.before !== null && report.fromLabel !== null
                ? ` · ${report.fromLabel}: ${tile.before}`
                : ''}
            </small>
          </div>
        ))}
      </div>

      {comparing && total > 0 ? (
        <section className="rv-panel" aria-label="Newly, kept and dropped">
          <h4>Questions that newly cite it, kept it, or dropped it</h4>
          <div
            className="rv-split"
            role="img"
            aria-label={`${story.split.newly} new, ${story.split.kept} kept, ${story.split.dropped} dropped`}
          >
            {(['newly', 'kept', 'dropped'] as const).map((part) =>
              story.split[part] > 0 ? (
                <span
                  key={part}
                  className={`rv-split-${part}`}
                  style={{ flexGrow: story.split[part] }}
                />
              ) : null
            )}
          </div>
          <p className="rv-legend-line">
            <span>
              <i className="rv-sw rv-sw-target" aria-hidden="true" />
              {story.split.newly} new
            </span>
            <span>
              <i className="rv-sw rv-sw-other" aria-hidden="true" />
              {story.split.kept} kept
            </span>
            <span>
              <i className="rv-sw rv-sw-not-cited" aria-hidden="true" />
              {story.split.dropped} dropped
            </span>
          </p>
        </section>
      ) : null}

      {story.waiting !== null ? (
        <section className="rv-panel rv-wait" aria-label="Why it is not cited yet">
          <h4>Why it is not cited yet, and what happens next</h4>
          <ul className="rv-wait-list">
            {story.waiting.map((reason) => (
              <li key={reason.reason} data-reason={reason.reason}>
                <b>{reason.title}.</b> {reason.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rv-grid2">
        <section className="rv-panel" aria-label="Dates">
          <h4>Dates</h4>
          <ol className="rv-timeline">
            {story.timeline.map((mark) => (
              <li key={mark.label}>
                <span className="rv-muted">{mark.label}</span> <b>{mark.day}</b>
              </li>
            ))}
          </ol>
        </section>
        <section className="rv-panel" aria-label="Position spread">
          <h4>Where it sits among the sources</h4>
          <table className="rv-mini rv-spread" aria-label="Position spread">
            <tbody>
              {story.spread.map((bucket) => (
                <tr key={bucket.label}>
                  <td className="num">{bucket.label}</td>
                  <td className="rv-spread-bar">
                    {bucket.before !== null ? (
                      <i
                        className="rv-spread-before"
                        style={{ width: `${(bucket.before / spreadMax) * 100}%` }}
                      />
                    ) : null}
                    <i
                      className="rv-spread-now"
                      style={{ width: `${(bucket.now / spreadMax) * 100}%` }}
                    />
                  </td>
                  <td className="rv-r num">
                    {bucket.before !== null ? `${bucket.before} → ` : ''}
                    {bucket.now}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {story.sites.length > 0 ? (
        <section className="rv-panel" aria-label="Sites cited beside it">
          <h4>Sites cited beside it</h4>
          <p className="rv-site-chips">
            {story.sites.map((site) => (
              <UrlText key={site.domain} domain={site.domain} className="rv-site-copy">
                <button
                  type="button"
                  className="rv-site-chip"
                  onClick={() => openReportDetail(siteDetail(site.domain))}
                >
                  {site.domain} <em className="num">{site.n}</em>
                </button>
              </UrlText>
            ))}
          </p>
        </section>
      ) : null}

      <section className="rv-panel" aria-label="Questions">
        {tabs.length > 1 ? (
          <div className="rv-chips" role="group" aria-label="Which questions">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                className={tab === id ? 'on' : undefined}
                onClick={() => setTab(id)}
              >
                {TAB_WORDS[id]}
                <em className="num">{story.tabs[id].length}</em>
              </button>
            ))}
          </div>
        ) : (
          <h4>Questions citing it now</h4>
        )}
        <QuestionTable
          rows={story.tabs[tabs.includes(tab) ? tab : 'now']}
          fromLabel={report.fromLabel}
          toLabel={report.toLabel}
          label={`Questions of ${page.path}: ${TAB_WORDS[tab]}`}
        />
      </section>
      {page.liveSince ? (
        <p className="rv-muted rv-small">Live since {formatWhen(page.liveSince)}.</p>
      ) : null}
    </div>
  )
}
