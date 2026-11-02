import { useMemo, type JSX, type ReactNode } from 'react'
import type { ImportCandidate, ImportCandidateList } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { Icon } from '../../components/Icon'
import { SM_BTN } from '../buttons'
import { DrillButton, DrillFigure } from '../../drill'
import { sectionHash } from '../../shell/routes'
import { RULE_OPS } from '../constants'
import type { SelectionActions } from '../hooks/useSelection'
import type { QuickPicks, RuleOp, SelectionState } from '../types'
import { clusterDrill, folderDrill, folderName } from '../utils/drills'
import { quickPickCount, ruleMatchCount } from '../utils/selection'
import { StepHead } from './StepHead'

const PICKS: readonly { id: keyof QuickPicks; label: string }[] = [
  { id: 'links', label: 'Pages with the most internal links' },
  { id: 'recent', label: 'Updated in the last 90 days' },
  { id: 'money', label: 'Money pages (pricing, features, compare, alternatives)' }
]

function isRuleOp(value: string): value is RuleOp {
  return RULE_OPS.some((op) => op.value === value)
}

export function ChooseStep({
  list,
  pool,
  state,
  actions,
  now,
  claudePick
}: {
  list: ImportCandidateList
  pool: readonly ImportCandidate[]
  state: SelectionState
  actions: SelectionActions
  now: number
  claudePick: ReactNode
}): JSX.Element {
  const pickCounts = useMemo(
    () => ({
      links: quickPickCount(pool, 'links', now),
      recent: quickPickCount(pool, 'recent', now),
      money: quickPickCount(pool, 'money', now)
    }),
    [pool, now]
  )
  return (
    <section className="imp-step imp-card" aria-labelledby="imp-step-2">
      <StepHead number={2} id="imp-step-2" title="Choose pages to track">
        Pick folders, add rules, or start from a quick pick. Everything you choose adds up.
      </StepHead>
      <div className="imp-choose">
        <fieldset className="imp-group">
          <legend className="imp-label">Folders</legend>
          {list.folders.length === 0 ? <p className="hint">No folders yet.</p> : null}
          {list.folders.map((folder) => {
            const tracked = folderDrill(list.rows, folder.folder, 'tracked')
            const all = folderDrill(list.rows, folder.folder, 'all')
            const name = folderName(folder.folder)
            return (
              <div className="imp-folder" key={folder.folder}>
                <label className="imp-folder-label">
                  <input
                    type="checkbox"
                    checked={state.folders.includes(folder.folder)}
                    onChange={() => actions.toggleFolder(folder.folder)}
                  />
                  <span className="mono imp-folder-name">{name}</span>
                </label>
                <DrillButton
                  drill={tracked}
                  className="tag imp-drill"
                  label={`${tracked.items.length.toLocaleString('en-US')} tracked in ${name}`}
                >
                  <DrillFigure drill={tracked} /> tracked
                </DrillButton>
                <DrillButton
                  drill={all}
                  className="mono faint drill-num"
                  label={`${pluralize(all.items.length, 'page')} in ${name}`}
                >
                  <DrillFigure drill={all} />
                </DrillButton>
              </div>
            )
          })}
        </fieldset>
        <div className="imp-group">
          <h3 className="imp-label">By cluster</h3>
          {list.clusters.length === 0 ? (
            <p className="hint">
              No clusters yet. Group pages by topic on{' '}
              <a href={sectionHash('structure')}>Site structure</a>, then pick them here.
            </p>
          ) : (
            <>
              <div className="imp-chips" role="group" aria-label="Clusters">
                {list.clusters.map((cluster) => {
                  const on = state.clusters.includes(cluster.id)
                  const drill = clusterDrill(list.rows, cluster)
                  return (
                    <span className="imp-chip-pair" key={cluster.id}>
                      <button
                        type="button"
                        className={on ? 'imp-chip on' : 'imp-chip'}
                        aria-pressed={on}
                        onClick={() => actions.toggleCluster(cluster.id)}
                      >
                        {cluster.name}
                      </button>
                      <DrillButton
                        drill={drill}
                        className="mono drill-num"
                        label={`${pluralize(drill.items.length, 'page')} in ${cluster.name}`}
                      >
                        <DrillFigure drill={drill} />
                      </DrillButton>
                    </span>
                  )
                })}
              </div>
              <p className="hint">
                Clusters are topic groups made on{' '}
                <a href={sectionHash('structure')}>Site structure</a>. Pages already in a ticked
                folder are counted once.
              </p>
            </>
          )}
        </div>
        <div className="imp-group">
          <h3 className="imp-label">Rules</h3>
          {state.rules.length > 0 ? <p className="muted">Track pages where</p> : null}
          {state.rules.map((rule, index) => (
            <div className="imp-rule" key={rule.id}>
              <select
                className="select"
                aria-label={`Rule ${index + 1} condition`}
                value={rule.op}
                onChange={(event) => {
                  if (isRuleOp(event.target.value)) {
                    actions.updateRule(rule.id, { op: event.target.value })
                  }
                }}
              >
                {RULE_OPS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                className="ob-input mono"
                aria-label={`Rule ${index + 1} value`}
                value={rule.value}
                placeholder="/compare/"
                onChange={(event) => actions.updateRule(rule.id, { value: event.target.value })}
              />
              <span className="faint imp-rule-count" aria-live="polite">
                {rule.value.trim() === ''
                  ? 'type a value'
                  : `${pluralize(ruleMatchCount(rule, pool), 'page')}${rule.op === 'not_contains' ? ' left out' : ''}`}
              </span>
              <button
                type="button"
                className={SM_BTN}
                aria-label={`Remove rule ${index + 1}`}
                onClick={() => actions.removeRule(rule.id)}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className={SM_BTN} onClick={actions.addRule}>
              <Icon name="plus" />
              Add rule
            </button>
          </div>
        </div>
        <div className="imp-group">
          <h3 className="imp-label">Quick picks</h3>
          <div className="imp-chips" role="group" aria-label="Quick picks">
            {PICKS.map((pick) => {
              const unavailable = pick.id === 'links' && !list.hasLinkData
              const on = state.picks[pick.id]
              return (
                <button
                  type="button"
                  key={pick.id}
                  className={on ? 'imp-chip on' : 'imp-chip'}
                  aria-pressed={on}
                  disabled={unavailable}
                  aria-describedby={unavailable ? 'imp-links-why' : undefined}
                  onClick={() => actions.togglePick(pick.id)}
                >
                  {pick.label}
                  <span className="mono">
                    {unavailable ? '—' : `+${pickCounts[pick.id].toLocaleString('en-US')}`}
                  </span>
                </button>
              )
            })}
          </div>
          {!list.hasLinkData ? (
            <p className="hint" id="imp-links-why">
              No internal-link data yet, so the most-linked pick is not available.
            </p>
          ) : null}
        </div>
        {claudePick}
      </div>
    </section>
  )
}
