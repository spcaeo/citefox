import { useEffect, useId, useState, type JSX } from 'react'
import type { ApiKeyMetadata, ProjectSchedule } from '@shared/domain'
import type { EngineEstimate, EngineSpendView } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../../../components/errorText'
import { cloroCreditsLeft, serpSearchesLeft } from '../../../keys/balances'
import { Button, KpiStrip, KpiTile } from '../../../ui'
import { formatCount } from '../../../keys/serpUsage'
import { EngineLogo } from '../../../engines/EngineLogo'
import { costText } from '../../../engines/model'
import { monthName, shortDay } from './model'
import type { MonthSpendSource } from './source'

interface Loaded {
  spend: EngineSpendView
  keys: readonly ApiKeyMetadata[]
  schedule: ProjectSchedule | null
  estimate: EngineEstimate | null
}

/**
 * Check history › This month (Engines board, panel 4): cloro credits and SerpApi
 * searches every project used this month with what is left, what this project's
 * checks spent, the next scheduled check with its price, and the month by engine.
 * The keys' balances are each key's last test, as Connections shows them.
 */
export function MonthSpend({
  source,
  projectId
}: {
  source: MonthSpendSource
  projectId: string
}): JSX.Element {
  const headingId = useId()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      source['engines:spend']({ projectId }),
      source['keys:list'](),
      // The next check and its price are extras: the box still shows without them.
      source['schedule:getProject']({ projectId }).catch(() => null),
      source['engines:estimate']({ projectId }).catch(() => null)
    ]).then(
      ([spend, keys, schedule, estimate]) => {
        if (cancelled) return
        setLoaded({ spend, keys, schedule, estimate })
        setError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not load this month’s spend.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt])

  if (loaded === null) {
    return (
      <section className="card hp-month" aria-labelledby={headingId} data-testid="month-spend">
        <h2 id={headingId} className="hp-month-title">
          This month
        </h2>
        {error ? (
          <p className="field-error" role="alert">
            {error}{' '}
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        ) : (
          <p className="hint" role="status">
            Loading this month’s spend…
          </p>
        )}
      </section>
    )
  }

  const { spend, keys, schedule, estimate } = loaded
  const cloro = spend.account.find((row) => row.provider === 'cloro')
  const serp = spend.account.find((row) => row.provider === 'serpapi')
  const creditsLeft = cloroCreditsLeft(keys)
  const searchesLeft = serpSearchesLeft(keys)
  const next = schedule?.nextCheckAt ?? null
  const nextPrice =
    estimate === null
      ? undefined
      : estimate.perCheck.credits > 0
        ? `≈ ${formatCount(estimate.perCheck.credits)} credits for every page`
        : `≈ ${pluralize(estimate.perCheck.searches, 'search', 'searches')} for every page`
  const month = monthName(spend.month)

  return (
    <section className="card hp-month" aria-labelledby={headingId} data-testid="month-spend">
      <h2 id={headingId} className="hp-month-title">
        This month
      </h2>
      <KpiStrip label={`Spend in ${month}`}>
        <KpiTile
          label="Search credits used"
          value={<span className="num">{formatCount(cloro?.credits ?? 0)}</span>}
          sub={
            creditsLeft === null ? 'No credit balance read yet' : `${formatCount(creditsLeft)} left`
          }
        />
        <KpiTile
          label="Searches used"
          value={<span className="num">{formatCount(serp?.searches ?? 0)}</span>}
          sub={searchesLeft === null ? 'Allowance not known' : `${formatCount(searchesLeft)} left`}
        />
        <KpiTile
          label="Spent"
          value={<span className="num">{costText(spend.total.costMicros)}</span>}
          sub={`${pluralize(spend.total.checks, 'check')} of this project in ${month}`}
        />
        <KpiTile
          label="Next scheduled"
          value={next === null ? 'Not scheduled' : shortDay(next)}
          {...(next !== null && nextPrice ? { sub: nextPrice } : {})}
        />
      </KpiStrip>
      {spend.byEngine.length > 0 ? (
        <ul className="hp-month-engines" aria-label={`This project's spend by engine in ${month}`}>
          {spend.byEngine.map((row) => (
            <li key={row.engine} className="hp-month-engine">
              <span className="hp-month-name" title={row.label}>
                <EngineLogo engine={row.engine} size={16} />
                {row.label}
              </span>
              <span className="num faint">
                {row.credits > 0
                  ? pluralize(row.credits, 'credit')
                  : pluralize(row.searches, 'search', 'searches')}
              </span>
              <span className="num">{costText(row.costMicros)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="hint">
        Credits and searches count every project&apos;s checks, as Connections does; Spent is this
        project&apos;s.
      </p>
    </section>
  )
}
