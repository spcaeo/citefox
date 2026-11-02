import { useId, useState, type JSX } from 'react'
import type { ClusterSummary } from '@shared/domain'
import { Button } from '../../ui'
import type { StructureClient } from '../client'
import type { RunAction } from '../types'

export interface MergeNote {
  fromName: string
  intoName: string
}

/** What the bar above the clusters grid edits: a name, or a merge target. */
export interface ClusterEdit {
  mode: 'rename' | 'merge'
  cluster: ClusterSummary
}

/** Rename a cluster or merge it into another, from the row's `⋯` menu. */
export function ClusterEditBar({
  client,
  projectId,
  edit,
  clusters,
  run,
  busy,
  onDone
}: {
  client: StructureClient
  projectId: string
  edit: ClusterEdit
  clusters: readonly ClusterSummary[]
  run: RunAction
  busy: string | null
  /** Called when the edit ends; a merge passes what was merged. */
  onDone: (merged: MergeNote | null) => void
}): JSX.Element {
  const id = useId()
  const { cluster } = edit
  const [draft, setDraft] = useState(cluster.name)
  const disabled = busy !== null

  async function saveName(): Promise<void> {
    const name = draft.trim()
    if (name.length === 0 || name === cluster.name) {
      onDone(null)
      return
    }
    const done = await run('Rename cluster', () =>
      client['structure:renameCluster']({ projectId, clusterId: cluster.id, name })
    )
    if (done) onDone(null)
  }

  async function mergeInto(target: ClusterSummary): Promise<void> {
    const done = await run('Merge clusters', () =>
      client['structure:mergeClusters']({
        projectId,
        fromClusterId: cluster.id,
        intoClusterId: target.id
      })
    )
    if (done) onDone({ fromName: cluster.name, intoName: target.name })
  }

  if (edit.mode === 'rename') {
    return (
      <form
        className="str-edit-bar"
        aria-label={`Rename ${cluster.name}`}
        onSubmit={(event) => {
          event.preventDefault()
          void saveName()
        }}
      >
        <label className="str-field-label" htmlFor={`${id}-r`}>
          New name for {cluster.name}
        </label>
        <input
          id={`${id}-r`}
          className="ui-input ui-input-sm str-grow"
          value={draft}
          maxLength={120}
          // The bar opens from a menu choice: put the cursor where the typing goes.
          autoFocus
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button type="submit" size="sm" disabled={disabled}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </form>
    )
  }

  return (
    <div className="str-edit-bar" role="group" aria-label={`Merge ${cluster.name}`}>
      <label className="str-field-label" htmlFor={`${id}-m`}>
        Merge {cluster.name} into
      </label>
      <select
        id={`${id}-m`}
        className="ui-input ui-input-sm str-grow"
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          const target = clusters.find((item) => item.id === event.currentTarget.value)
          if (target) void mergeInto(target)
        }}
      >
        <option value="" disabled>
          Pick a cluster…
        </option>
        {clusters
          .filter((item) => item.id !== cluster.id)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
      </select>
      <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
        Cancel
      </Button>
    </div>
  )
}
