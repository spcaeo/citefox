import { useState, type JSX } from 'react'
import type { MetricsResult } from '@shared/metrics'
import { isRivalSite, rivalOrder, type ReportKind, type ReviewReport } from '@shared/report/review'
import type { BrandingMode } from '@shared/report/review/sender'
import { formatDay } from '../../utils/dates'
import { HomeCard, type CardEnv } from './HomeCard'

/** Opens a report on one tab (and optionally one drawer), already filtered. */
export type OpenGoal = (kind: ReportKind, extra?: Readonly<Record<string, string>>) => void

/** The pitch goal's words for who the reports are from (Settings › Reports, branding mode). */
const PITCH_WORDS: Readonly<Record<BrandingMode, { title: string; line: string }>> = {
  agency: { title: 'Pitch a new client', line: 'A short audit you can send.' },
  company: { title: 'Brief your leadership', line: 'A short audit for your boss.' },
  none: { title: 'One-page audit', line: 'A short audit from one check.' }
}

/**
 * Reports › By goal (owner 2026-11-02, the default view): what a marketer or agency
 * needs to show, each opening the report that answers it on the right tab. A goal
 * that cannot say anything yet names what it needs instead of "Ready".
 */
export function GoalsView({
  report,
  metrics,
  onOpen,
  env,
  mode = 'agency'
}: {
  report: ReviewReport | null
  metrics: MetricsResult | null
  onOpen: OpenGoal
  env: CardEnv
  /** Who the reports are from: agency, in-house company, or none (one person). */
  mode?: BrandingMode
}): JSX.Element {
  const now = metrics?.now ?? null
  const checks = metrics?.checks.length ?? 0
  const last = metrics?.checks.at(-1)?.at ?? null
  const fixes = report?.published.rows.length ?? 0
  const bar = (id: string): number =>
    report?.visibility.opportunity.bars.find((item) => item.id === id)?.value.n ?? 0
  // Rivals: saved competitors first, then other businesses; never Reddit, YouTube or the like.
  const rivals = (report?.competition.sites ?? [])
    .filter(isRivalSite)
    .sort(rivalOrder)
    .slice(0, 10)
    .map((site) => ({
      domain: site.domain,
      now: site.now.n,
      withYou: site.withYou?.n ?? 0
    }))
  const [rival, setRival] = useState<string | null>(null)
  const picked = rivals.find((site) => site.domain === rival) ?? rivals[0] ?? null
  const without = now === null ? 0 : Math.max(0, now.answered.n - now.cited.n)
  const secondCheck = checks < 2 ? 'Needs a 2nd check' : null
  const reading = report === null || now === null
  const pitch = PITCH_WORDS[mode]
  // The rival card downloads the head-to-head against the rival picked here.
  const rivalEnv: CardEnv = {
    ...env,
    requestFor: (kind) =>
      kind === 'rival' && picked !== null
        ? { ...env.requestFor(kind), rival: picked.domain }
        : env.requestFor(kind)
  }

  return (
    <div className="rv-goals">
      <div className="rv-goal-grid">
        <HomeCard
          kind="visibility"
          env={env}
          title="Where do we stand?"
          line="Who cites you, and who wins instead."
          reading={reading}
          peek={
            now ? (
              <>
                <b className="num">
                  {now.cited.n} of {now.checked.n}
                </b>{' '}
                cite you · {without} answer without you
              </>
            ) : null
          }
          onOpen={() => onOpen('visibility', { section: 'standing' })}
        />
        <HomeCard
          kind="pitch"
          env={env}
          title={pitch.title}
          line={pitch.line}
          reading={reading}
          peek={
            report ? (
              <>
                <b className="num">{bar('invisible')}</b> invisible ·{' '}
                <b className="num">{bar('wrongpage')}</b> wrong page ·{' '}
                <b className="num">{bar('ugc')}</b> lost to Reddit or YouTube
              </>
            ) : null
          }
          onOpen={() => onOpen('pitch')}
        />
        <HomeCard
          kind="content"
          env={env}
          title="What should we write next?"
          line="The pages to write or fix first."
          reading={reading}
          peek={
            now ? (
              <>
                <b className="num">{without}</b> to write ·{' '}
                <b className="num">{bar('wrongpage')}</b> to fix
              </>
            ) : null
          }
          onOpen={() => onOpen('content')}
        />
        <HomeCard
          kind="rival"
          env={rivalEnv}
          title="Us vs one competitor"
          line="Where one rival gets cited and you don't."
          reading={reading}
          waiting={report && rivals.length === 0 ? 'No other sites cited yet' : null}
          peek={
            picked ? (
              <label className="rv-goal-pick">
                <select
                  aria-label="Competitor"
                  value={picked.domain}
                  onChange={(event) => setRival(event.target.value)}
                >
                  {rivals.map((site) => (
                    <option key={site.domain} value={site.domain}>
                      {site.domain}
                    </option>
                  ))}
                </select>
                <span>
                  {picked.now} questions · {picked.now - picked.withYou} without you
                </span>
              </label>
            ) : null
          }
          openDisabled={picked === null}
          onOpen={() => {
            if (picked !== null) onOpen('rival', { rival: picked.domain })
          }}
        />
        <HomeCard
          kind="changed"
          env={env}
          title="What changed?"
          line="Gains and losses since the last check."
          reading={reading}
          waiting={metrics ? secondCheck : null}
          peek={
            metrics && checks < 2 ? (
              <>One check so far{last ? ` (${formatDay(last)})` : ''}.</>
            ) : metrics?.comparison ? (
              <>
                {metrics.comparison.movement.gained.n} gained · {metrics.comparison.movement.lost.n}{' '}
                lost
              </>
            ) : null
          }
          meta={
            <button
              type="button"
              className="rv-link"
              onClick={() => onOpen('changed', { section: 'questions', show: 'lost' })}
            >
              Explaining a drop? See lost questions →
            </button>
          }
          onOpen={() => onOpen('changed')}
        />
        <HomeCard
          kind="impact"
          env={env}
          title="Did our fixes work?"
          line="What your published pages did."
          reading={reading}
          waiting={report && fixes === 0 ? 'Needs a logged fix' : null}
          peek={
            report && fixes === 0 ? (
              <>No fixes logged yet.</>
            ) : report ? (
              <>
                <span className={`rv-badge rv-badge-${report.verdict.badge.tone}`}>
                  {report.verdict.badge.label}
                </span>{' '}
                {fixes} pages published · {report.published.rows.filter((p) => p.now > 0).length}{' '}
                cited already
              </>
            ) : null
          }
          onOpen={() => onOpen('impact')}
        />
      </div>
    </div>
  )
}
