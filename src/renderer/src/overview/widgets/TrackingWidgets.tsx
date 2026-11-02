import { useMemo, type JSX } from 'react'
import { ENGINE_SHORT_LABEL } from '@shared/domain'
import type { ChangeLedger, EngineSpendView, StatusCapsule } from '@shared/ipc'
import { GOOGLE_UPDATES } from '@shared/google-updates'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import { fixGroupDrills, GROUP_TITLE } from './fixGroups'
import { usePageChanges } from '../../pageChanges/hooks'
import { changePath } from '../../pageChanges/model'
import { useEngineRevision } from '../../shell/engineRevision'
import { useChangeVersion } from '../../shell/changes'
import { sectionHash } from '../../shell/routes'
import { formatDay, formatMoment } from '../../utils/dates'
import { useWidgetMetrics } from './env'
import { engineWords, metricRowsDrill, widgetScope } from './metricDrills'
import type { WidgetProps } from './SummaryWidgets'
import { aroundDay, trendSteps } from './trendModel'
import { useCachedRead } from './useCachedRead'
import { WidgetCard, WidgetNote } from './WidgetCard'

/**
 * Widgets about the work and the world around it: fixes and their verdicts, Google
 * updates, searches and credits, and page changes nobody logged.
 */

export function FixesWorkingWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const revision = useEngineRevision()
  const changes = useChangeVersion('fixes')
  const read = env.source['fixes:ledger']
  const ledger = useCachedRead<ChangeLedger>(
    read === undefined ? null : `ledger|${env.projectId}|${revision}|${changes}`,
    () =>
      read === undefined
        ? Promise.reject(new Error('No fixes'))
        : read({ projectId: env.projectId })
  )
  const drills = useMemo(
    () => (ledger.data === null ? null : fixGroupDrills(ledger.data)),
    [ledger.data]
  )
  const small = widget.size === 's'
  return (
    <WidgetCard title="Fixes working" tools={tools}>
      {drills === null ? (
        <WidgetNote loading={ledger.loading} error={ledger.error} />
      ) : drills.worked.items.length + drills.early.items.length + drills.none.items.length ===
        0 ? (
        <WidgetNote>
          No fixes logged yet. <a href={sectionHash('fixes')}>Log a fix in Fixes</a>
        </WidgetNote>
      ) : (
        <div className={small ? 'wb-verdicts wb-verdicts-stack' : 'wb-verdicts'}>
          {(['worked', 'early', 'none'] as const).map((group) => (
            <div key={group} className="wb-verdict" data-tone={group}>
              <span className="wb-verdict-num num">
                <DrillNumber
                  drill={drills[group]}
                  label={`${drills[group].items.length} fixes: ${GROUP_TITLE[group]}`}
                />
              </span>
              <span className="wb-verdict-label">{GROUP_TITLE[group]}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

export function GoogleUpdatesWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const metrics = useWidgetMetrics(env, { kind: 'project' }, widget.engine)
  const words = engineWords(widget.engine)
  const shown = widget.size === 'm' ? 3 : 5
  const updates = useMemo(
    () =>
      [...GOOGLE_UPDATES].sort((a, b) => b.startedOn.localeCompare(a.startedOn)).slice(0, shown),
    [shown]
  )
  const effects = useMemo(() => {
    if (metrics.data === null) return null
    const steps = trendSteps(metrics.data, 400)
    const scope = widgetScope(env.data, env.marketLabel)
    return new Map(
      updates.map((update) => {
        const { before, after } = aroundDay(steps, update.startedOn, update.finishedOn)
        const drill = (rows: typeof before, when: 'before' | 'after'): ItemDrill | null =>
          rows === null
            ? null
            : metricRowsDrill(
                rows.cited,
                {
                  id: `w:google:${widget.engine}:${update.id}:${when}`,
                  title: `Cited ${words} ${when} the ${update.name}`,
                  description: `Questions citing you ${words} at the check of ${formatDay(rows.at)}, ${when} the update.`
                },
                scope
              )
        return [update.id, { before: drill(before, 'before'), after: drill(after, 'after') }]
      })
    )
  }, [metrics.data, updates, env.data, env.marketLabel, widget.engine, words])
  return (
    <WidgetCard title="Google updates" tools={tools}>
      <ul className="wb-updates">
        {updates.map((update) => {
          const effect = effects?.get(update.id)
          return (
            <li key={update.id} className="wb-update">
              <span className="wb-update-head">
                <a
                  className="wb-list-link"
                  href={update.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {update.name}
                </a>
                <span className="wb-update-when">
                  {formatDay(`${update.startedOn}T12:00:00.000Z`, { year: false })}
                  {update.finishedOn === null ? ' · rolling out' : ''}
                </span>
              </span>
              <span className="wb-update-effect">
                {effect === undefined ? (
                  metrics.loading ? (
                    'Loading…'
                  ) : (
                    ''
                  )
                ) : effect.before === null ? (
                  'Before your first check'
                ) : (
                  <>
                    Cited{' '}
                    <DrillNumber
                      drill={effect.before}
                      label={`${effect.before.items.length} cited before ${update.name}`}
                    />
                    {' → '}
                    {effect.after === null ? (
                      'no check since'
                    ) : (
                      <DrillNumber
                        drill={effect.after}
                        label={`${effect.after.items.length} cited after ${update.name}`}
                      />
                    )}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </WidgetCard>
  )
}

export function CreditsWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const revision = useEngineRevision()
  const capsuleRead = env.source['status:getCapsule']
  const spendRead = env.source['engines:spend']
  const capsule = useCachedRead<StatusCapsule>(
    capsuleRead === undefined ? null : `capsule|${revision}`,
    () => (capsuleRead === undefined ? Promise.reject(new Error('No status')) : capsuleRead())
  )
  const spend = useCachedRead<EngineSpendView>(
    spendRead === undefined ? null : `spend|${env.projectId}|${revision}`,
    () =>
      spendRead === undefined
        ? Promise.reject(new Error('No spend'))
        : spendRead({ projectId: env.projectId })
  )
  const engine = widget.engine
  const checks = useMemo<ItemDrill | null>(() => {
    if (spend.data === null) return null
    const list = spend.data.checks.filter(
      (check) => engine === 'all' || check.engines.includes(engine)
    )
    return {
      kind: 'items',
      id: `w:credits:${engine}:checks`,
      title: `Checks this month ${engineWords(engine)}`,
      description: 'Each check this month in this project, with the CiteFox credits it used.',
      noun: ['check', 'checks'],
      primaryLabel: 'Check',
      columns: [
        { id: 'credits', label: 'Credits', align: 'end', width: '96px' },
        { id: 'searches', label: 'Searches', align: 'end', width: '96px' }
      ],
      items: list.map((check) => ({
        id: check.jobId,
        primary: formatMoment(check.startedAt),
        secondary: check.engines.map((id) => ENGINE_SHORT_LABEL[id]).join(' · '),
        cells: { credits: check.credits, searches: check.searches },
        target: { kind: 'hash', hash: sectionHash('history') }
      })),
      scope: widgetScope(env.data, env.marketLabel)
    }
  }, [spend.data, engine, env.data, env.marketLabel])
  const credits =
    spend.data === null
      ? null
      : engine === 'all'
        ? spend.data.total.credits
        : (spend.data.byEngine.find((row) => row.engine === engine)?.credits ?? 0)
  const left = capsule.data?.searchesLeft ?? null
  return (
    <WidgetCard title="Searches and credits" tools={tools}>
      <div className="wb-stat">
        <p className="wb-stat-value num">{left === null ? '—' : left.toLocaleString('en-US')}</p>
        <p className="wb-stat-line">
          {left === null ? 'No search limit set' : 'searches left'} ·{' '}
          <a href={sectionHash('status')}>Usage</a>
        </p>
        {checks === null ? (
          <WidgetNote loading={spend.loading} error={spend.error} />
        ) : (
          <p className="wb-stat-line">
            <DrillButton
              drill={checks}
              className="drill-num"
              label={`${checks.items.length} checks this month: open them`}
            >
              <span data-nfr-figure={checks.id}>{checks.items.length}</span>
            </DrillButton>{' '}
            {checks.items.length === 1 ? 'check' : 'checks'} this month
            {credits === null ? '' : ` · ${credits.toLocaleString('en-US')} credits`}
          </p>
        )}
      </div>
    </WidgetCard>
  )
}

export function PageChangesWidget({ widget, env, tools }: WidgetProps): JSX.Element {
  const { list, error } = usePageChanges(env.projectId)
  const drill = useMemo<ItemDrill | null>(() => {
    if (list === null) return null
    const open = list.changes.filter((change) => change.state === 'open')
    return {
      kind: 'items',
      id: 'w:page-changes:open',
      title: 'Page changes nobody logged',
      description:
        'Pages that changed with no fix logged. Log each one, or mark it not a fix.',
      noun: ['change', 'changes'],
      primaryLabel: 'Page',
      columns: [{ id: 'when', label: 'Changed', width: 'minmax(140px, 0.5fr)' }],
      items: open.map((change) => ({
        id: change.id,
        primary: change.label ?? changePath(change),
        secondary: change.sentence,
        cells: { when: formatMoment(change.changedAt) },
        target: { kind: 'drawer', id: 'page-change', values: { 'pc.id': change.id } }
      })),
      scope: widgetScope(env.data, env.marketLabel)
    }
  }, [list, env.data, env.marketLabel])
  const shown = widget.size === 's' ? 0 : widget.size === 'm' ? 3 : 6
  return (
    <WidgetCard title="Page changes nobody logged" tools={tools}>
      {drill === null ? (
        <WidgetNote loading={error === null} error={error} />
      ) : drill.items.length === 0 ? (
        <WidgetNote>Every page change is logged or marked. Nice.</WidgetNote>
      ) : (
        <>
          <p className="wb-line">
            <DrillNumber
              drill={drill}
              suffix={drill.items.length === 1 ? ' change' : ' changes'}
              label={`${drill.items.length} page changes nobody logged`}
            />{' '}
            to look at
          </p>
          {shown > 0 ? (
            <ul className="wb-list">
              {drill.items.slice(0, shown).map((item) => (
                <li key={item.id} className="wb-list-row wb-list-two">
                  <span className="wb-list-text">{item.primary}</span>
                  <span className="wb-list-meta">{item.cells?.when}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </WidgetCard>
  )
}
