import { useEffect, useMemo, useState } from 'react'
import type { MetricsRequest, MetricsResult } from '@shared/ipc'
import {
  buildReport,
  EMPTY_EXTRAS,
  type ReportContext,
  type ReportExtras,
  type ReviewReport
} from '@shared/report/review'
import { errorText } from '../../components/errorText'
import type { ReviewClient } from './client'

export interface ReviewData {
  metrics: MetricsResult | null
  report: ReviewReport | null
  loading: boolean
  problem: string | null
}

/**
 * One ready report: reads `reports:metrics` for the request and builds the report the
 * screen draws. A newer request wins over an older answer still on its way.
 */
export function useReviewData(
  client: ReviewClient,
  request: MetricsRequest | null,
  ctx: ReportContext
): ReviewData {
  const key = request === null ? '' : JSON.stringify(request)
  const [state, setState] = useState<{
    key: string
    metrics: MetricsResult | null
    extras: ReportExtras
    problem: string | null
  }>({ key: '', metrics: null, extras: EMPTY_EXTRAS, problem: null })

  useEffect(() => {
    if (key === '') return
    let live = true
    const asked = JSON.parse(key) as MetricsRequest
    const read = client.review
      ? client.review(asked)
      : client.metrics(asked).then((metrics) => ({ metrics, extras: EMPTY_EXTRAS }))
    read.then(
      ({ metrics, extras }) => {
        if (live) setState({ key, metrics, extras, problem: null })
      },
      (error: unknown) => {
        if (live) {
          setState({
            key,
            metrics: null,
            extras: EMPTY_EXTRAS,
            problem: errorText(error, 'Could not read the checks for this report.')
          })
        }
      }
    )
    return () => {
      live = false
    }
  }, [client, key])

  const { brand, domain, kind, day, marketLabel, engineLabel, scopeLabel, rival } = ctx
  const { metrics, extras } = state
  const report = useMemo(
    () =>
      metrics === null
        ? null
        : buildReport(
            metrics,
            {
              brand,
              domain,
              kind,
              day,
              marketLabel,
              engineLabel,
              ...(scopeLabel ? { scopeLabel } : {}),
              ...(rival ? { rival } : {})
            },
            extras
          ),
    [metrics, extras, brand, domain, kind, day, marketLabel, engineLabel, scopeLabel, rival]
  )
  return {
    metrics,
    report,
    loading: key !== '' && state.key !== key,
    problem: state.key === key ? state.problem : null
  }
}
