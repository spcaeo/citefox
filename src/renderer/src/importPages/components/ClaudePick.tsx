import { useId, useState, type JSX } from 'react'
import type { ClaudePickResult, ImportCandidate } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { Icon } from '../../components/Icon'
import { AI_BTN, SM_BTN } from '../buttons'
import { DrillButton, DrillFigure } from '../../drill'
import type { StructureClient } from '../../structure/client'
import { errorMessage } from '../hooks/useImportCandidates'
import { pickedDrill } from '../utils/drills'

/**
 * FR-20.6 "Claude's pick". Calls `import:claudePick` and hands the page ids
 * to the selection. Remove takes them out again; Dismiss hides the panel.
 */
export function ClaudePick({
  client,
  projectId,
  appliedCount,
  rows,
  onApply
}: {
  client: StructureClient
  projectId: string
  appliedCount: number
  /** The page list, to show the picked pages. */
  rows: readonly ImportCandidate[]
  onApply: (pageIds: readonly string[]) => void
}): JSX.Element {
  const askId = useId()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ClaudePickResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function run(): Promise<void> {
    setOpen(true)
    setBusy(true)
    setError(null)
    try {
      const next = await client['import:claudePick']({
        projectId,
        instruction: instruction.trim() || null
      })
      setResult(next)
      onApply(next.pageIds)
    } catch (cause) {
      setError(errorMessage(cause, 'CiteFox AI could not pick pages this time.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="imp-group">
      <h3 className="imp-label">CiteFox AI&apos;s pick</h3>
      <div className="imp-inline">
        <button type="button" className={AI_BTN} disabled={busy} onClick={() => void run()}>
          <Icon name="spark" />
          {busy ? 'CiteFox AI is picking…' : 'Pick the pages most likely to win AI Overviews'}
        </button>
      </div>
      {open ? (
        <div className="imp-ai" role="region" aria-label="CiteFox AI's pick">
          <p className="faint imp-ai-tag">CiteFox AI · on your plan · about 30 s</p>
          <div className="imp-inline">
            <label className="sr-only" htmlFor={askId}>
              Tell CiteFox AI what to change
            </label>
            <input
              id={askId}
              className="ob-input"
              placeholder="Tell CiteFox AI what to change"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {result ? (
            <>
              <p>
                <strong>
                  Picked <PickedCount rows={rows} pageIds={result.pageIds} />
                </strong>
              </p>
              {result.reasons.length > 0 ? (
                <ul className="imp-ai-list">
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <p className="hint">
                Pages you already track are left out, and each page is counted once.
              </p>
              <p role="status">
                {appliedCount > 0
                  ? `Added ${pluralize(appliedCount, 'page')} to your selection.`
                  : 'Removed from your selection.'}
              </p>
            </>
          ) : null}
          <div className="actions">
            {result && appliedCount > 0 ? (
              <button type="button" className={SM_BTN} onClick={() => onApply([])}>
                Remove
              </button>
            ) : null}
            <button type="button" className={SM_BTN} disabled={busy} onClick={() => void run()}>
              Try again
            </button>
            <button
              type="button"
              className={SM_BTN}
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {!open && appliedCount > 0 ? (
        <p className="imp-ai-applied">
          <span className="tag">
            CiteFox AI&apos;s pick: {pluralize(appliedCount, 'page')} added
          </span>
          <button type="button" className={SM_BTN} onClick={() => onApply([])}>
            Remove
          </button>
        </p>
      ) : null}
    </div>
  )
}

function PickedCount({
  rows,
  pageIds
}: {
  rows: readonly ImportCandidate[]
  pageIds: readonly string[]
}): JSX.Element {
  if (pageIds.length === 0) return <>0 pages</>
  const drill = pickedDrill(rows, pageIds)
  return (
    <DrillButton
      drill={drill}
      className="drill-num"
      label={`Show the ${pluralize(pageIds.length, 'page')} CiteFox AI picked`}
    >
      <DrillFigure drill={drill} /> {pageIds.length === 1 ? 'page' : 'pages'}
    </DrillButton>
  )
}
