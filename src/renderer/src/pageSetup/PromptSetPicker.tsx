import { useEffect, useId, useState, type JSX } from 'react'
import type { PromptSetRef, PromptSetView } from '@shared/domain'
import { promptSetLabel, type PromptSetsClient } from './promptSets'
import { errorText } from './text'

/**
 * Compact picker for the page's saved prompt sets, newest first.
 * Switching makes the chosen set the one in use. It does not write a new version.
 * Hidden until the page has two saved sets.
 */
export function PromptSetPicker({
  client,
  projectId,
  pageId,
  view,
  onSwitched
}: {
  client: PromptSetsClient
  projectId: string
  pageId: string
  view: PromptSetView
  onSwitched: (next: PromptSetView) => void
}): JSX.Element | null {
  const id = useId()
  const [sets, setSets] = useState<readonly PromptSetRef[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeId = view.promptSetId

  useEffect(() => {
    let cancelled = false
    void client.listSets({ projectId, pageId }).then(
      (list) => {
        if (!cancelled) setSets(list.sets)
      },
      () => {
        if (!cancelled) setSets([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, activeId])

  if (sets.length < 2) return null

  async function choose(promptSetId: string): Promise<void> {
    if (promptSetId === activeId) return
    setBusy(true)
    setError(null)
    try {
      onSwitched(await client.setActive({ projectId, pageId, promptSetId }))
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not switch the question set.'))
    } finally {
      setBusy(false)
    }
  }

  const selected = sets.find((set) => set.id === activeId)?.id ?? sets[0]?.id ?? ''
  return (
    <div className="ps-version-pick">
      <label className="field" htmlFor={id}>
        <span className="field-label">Question set version</span>
        <select
          id={id}
          className="select"
          value={selected}
          disabled={busy || view.dirty}
          onChange={(event) => void choose(event.target.value)}
        >
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {promptSetLabel(set)}
            </option>
          ))}
        </select>
      </label>
      {view.dirty ? (
        <p className="hint">Save or discard your edits before you switch versions.</p>
      ) : (
        <p className="hint">Switching does not save a new version. Past checks keep theirs.</p>
      )}
      {error ? (
        <p className="ps-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
