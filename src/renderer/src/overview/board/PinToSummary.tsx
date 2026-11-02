import { useState, type JSX } from 'react'
import { IconButton } from '../../ui'
import type { WidgetSpec } from './model'
import { pinToSummary } from './pin'
import type { BoardStore } from './store'

/**
 * "Pin to Summary" (owner-approved mock-up): a small pin on a chart or list anywhere in
 * the app that adds a widget for that thing to the project's Summary, with Undo.
 */
export function PinToSummary({
  projectId,
  spec,
  name,
  store
}: {
  projectId: string
  spec: WidgetSpec
  /** What is pinned, in a few words: "this topic’s trend", "zapier.com". */
  name: string
  /** Tests pass their own. Default: the project file over IPC. */
  store?: BoardStore | null
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <IconButton
      icon="pin"
      size="sm"
      tip
      className="wb-pin"
      label={`Pin ${name} to Summary`}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void pinToSummary(projectId, spec, name, store).finally(() => setBusy(false))
      }}
      data-testid="pin-to-summary"
    />
  )
}
