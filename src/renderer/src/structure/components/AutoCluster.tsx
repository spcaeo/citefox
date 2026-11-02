import { useId, useState, type JSX } from 'react'
import type { ClusterMethod } from '@shared/domain'
import type { ReclusterResult, StructureView } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { AiMenu, Button, Panel, SuggestionCard } from '../../ui'
import { HeaderActions } from '../../components/HeaderActions'
import type { StructureClient } from '../client'
import { METHOD_OPTIONS, METHOD_UNAVAILABLE, RECLUSTER_APPLIED } from '../constants'
import type { RunAction } from '../types'

const CLAUDE_SECONDS = 30

/**
 * FR-19.4. Re-cluster with Claude (the section's one AI menu) or by rules,
 * keep manual edits, undo. The result shows as one suggestion card.
 */
export function AutoCluster({
  client,
  projectId,
  view,
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  view: StructureView
  run: RunAction
  busy: string | null
}): JSX.Element {
  const id = useId()
  const available = view.availableMethods
  const [method, setMethod] = useState<ClusterMethod>(
    available.includes('topic') ? 'topic' : (available[0] ?? 'topic')
  )
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<ReclusterResult | null>(null)
  const hint = METHOD_OPTIONS.find((option) => option.id === method)?.hint ?? ''
  const claudeBusy = busy === 'Auto-cluster with CiteFox AI'

  async function recluster(useClaude: boolean): Promise<void> {
    const text = instruction.trim()
    const done = await run(useClaude ? 'Auto-cluster with CiteFox AI' : 'Group by rules', () =>
      client['structure:recluster']({
        projectId,
        method,
        useClaude,
        instruction: useClaude && text.length > 0 ? text : null
      })
    )
    setResult(done)
  }

  async function undo(): Promise<void> {
    const done = await run('Undo clusters', () => client['structure:undoClusters']({ projectId }))
    if (done) setResult(null)
  }

  return (
    <div className="page-stack str-auto">
      <Panel
        title="Re-cluster"
        titleAs="h3"
        padding={20}
        actions={
          <>
            {view.canUndoClusters ? (
              <HeaderActions
                more={[
                  {
                    id: 'rc-undo',
                    label: 'Undo last re-cluster',
                    icon: 'refresh',
                    disabled: busy !== null,
                    onSelect: () => void undo()
                  }
                ]}
                moreLabel="Re-cluster actions"
              />
            ) : null}
            <Button
              size="sm"
              busy={busy === 'Group by rules'}
              disabled={busy !== null}
              onClick={() => void recluster(false)}
            >
              {busy === 'Group by rules' ? 'Grouping…' : 'Group by rules (no AI)'}
            </Button>
            <AiMenu
              label="AI actions for clusters"
              footer="CiteFox AI · on your plan. Uses your pages, no searches. Manual edits are kept."
              actions={[
                {
                  id: 'auto-cluster',
                  label: claudeBusy ? 'Clustering…' : 'Auto-cluster with CiteFox AI',
                  seconds: CLAUDE_SECONDS,
                  disabled: busy !== null,
                  onSelect: () => void recluster(true)
                }
              ]}
            />
          </>
        }
      >
        <div className="str-auto-row">
          <fieldset className="str-rule str-rule-inline">
            <legend className="str-field-label">Cluster by</legend>
            <div className="str-choices">
              {METHOD_OPTIONS.map((option) => {
                const enabled = available.includes(option.id)
                return (
                  <label
                    key={option.id}
                    className="str-choice"
                    title={enabled ? undefined : METHOD_UNAVAILABLE[option.id]}
                  >
                    <input
                      type="radio"
                      name={`${id}-method`}
                      value={option.id}
                      checked={method === option.id}
                      disabled={!enabled || busy !== null}
                      aria-describedby={enabled ? undefined : `${id}-${option.id}`}
                      onChange={() => setMethod(option.id)}
                    />
                    {option.label}
                    {enabled ? null : (
                      <span id={`${id}-${option.id}`} className="sr-only">
                        {METHOD_UNAVAILABLE[option.id]}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="str-auto-ask">
            <label className="str-field-label" htmlFor={`${id}-ask`}>
              Tell CiteFox AI what to change <span className="str-muted">(optional)</span>
            </label>
            <input
              id={`${id}-ask`}
              className="ui-input ui-input-sm"
              value={instruction}
              placeholder="For example: keep carrier shutdown posts in their own cluster"
              onChange={(event) => setInstruction(event.currentTarget.value)}
            />
          </div>
        </div>
        <p className="str-hint">
          {hint} Manual edits are kept when you re-cluster.
          {available.includes('links') ? '' : ` Internal links: ${METHOD_UNAVAILABLE.links}`}
        </p>
      </Panel>
      {claudeBusy ? (
        <p className="str-hint" role="status">
          CiteFox AI is clustering · about {CLAUDE_SECONDS} s · uses your pages, no searches
        </p>
      ) : result ? (
        <SuggestionCard
          title={`Found ${pluralize(result.view.clusters.length, 'cluster')} (${result.previousCount.toLocaleString('en-US')} before)`}
          body={
            <div role="status">
              {result.changes.length > 0 ? (
                <ul className="str-list">
                  {result.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              ) : null}
              <p>{RECLUSTER_APPLIED}</p>
            </div>
          }
          footnote="Uses your pages, no searches"
          onClose={() => setResult(null)}
        />
      ) : null}
    </div>
  )
}
