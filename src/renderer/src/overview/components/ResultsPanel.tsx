import { useEffect, useMemo, type JSX } from 'react'
import type { VisibilityOverview } from '@shared/ipc'
import { DrillButton, DrillNumber, useDrill, type ItemDrill } from '../../drill'
import { drawerHref } from '../../shell/drawers'
import { ResultBar } from '../../ui'
import { countResults, RESULT_BUCKETS, totalResults } from '../../ui/resultTones'
import { needsWorkDrill, resultDrill, resultDrillId } from '../drills'
import { needsWork, OVERVIEW_LINKS, questionResult } from '../model'

/**
 * Where the latest checks ended, in the four shared results (owner, 2026-10-29):
 * the bar and its legend, each count opening its searches, then how many need
 * work, with the way to Fixes, where they are rolled up into page fixes. It sits
 * inside the verdict card, so it has no card or title of its own.
 */
export function ResultsPanel({
  data,
  pageFixes = null,
  fixesDrill = null
}: {
  data: VisibilityOverview
  /** Page fixes to do in the project (the Fixes badge). Null while unknown. */
  pageFixes?: number | null
  /** Every page fix to do, which "N page fixes" opens. Null while loading. */
  fixesDrill?: ItemDrill | null
}): JSX.Element | null {
  const { register } = useDrill()
  const counts = useMemo(() => countResults(data.questions, questionResult), [data])
  const drills = useMemo(
    () => RESULT_BUCKETS.map((bucket) => resultDrill(data, bucket.key)),
    [data]
  )
  const work = useMemo(() => needsWorkDrill(data), [data])
  // The legend counts are links to their drill: register each so the link opens it.
  useEffect(() => {
    for (const drill of drills) register(drill)
  }, [drills, register])
  const total = totalResults(counts)
  if (total === 0) return null
  const searches = `${total.toLocaleString('en-US')} ${total === 1 ? 'search' : 'searches'}`
  const workCount = needsWork(counts)
  return (
    <div className="ov-results" role="group" aria-label={`Results: ${searches}, latest checks`}>
      <ResultBar
        counts={counts}
        size="header"
        label={searches}
        hrefFor={(key) => drawerHref('drill', { drill: resultDrillId(key) })}
      />
      <p className="ov-results-work">
        Needs work:{' '}
        <DrillNumber
          drill={work}
          className="ov-finding-num"
          label={`${workCount.toLocaleString('en-US')} searches need work`}
        />{' '}
        {workCount === 1 ? 'search' : 'searches'}
        {workCount > 0 ? (
          <>
            {' '}
            ·{' '}
            {fixesDrill !== null && fixesDrill.items.length > 0 ? (
              // The page fixes open over Summary; each opens its fix drawer on top.
              <DrillButton
                drill={fixesDrill}
                className="ov-link ov-link-button"
                label={`${fixesDrill.items.length.toLocaleString('en-US')} page ${fixesDrill.items.length === 1 ? 'fix' : 'fixes'}: open them`}
              >
                <span data-nfr-figure={fixesDrill.id}>
                  {fixesDrill.items.length.toLocaleString('en-US')}
                </span>{' '}
                page {fixesDrill.items.length === 1 ? 'fix' : 'fixes'} →
              </DrillButton>
            ) : (
              <a className="ov-link" href={OVERVIEW_LINKS.fixes}>
                {pageFixes !== null && pageFixes > 0
                  ? `${pageFixes.toLocaleString('en-US')} page ${pageFixes === 1 ? 'fix' : 'fixes'} →`
                  : 'See them in Fixes →'}
              </a>
            )}
          </>
        ) : null}
      </p>
    </div>
  )
}
