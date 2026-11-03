import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { LostGroundView, RecoveryPlan as Plan } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { Markdown } from '../components/Markdown'
import { cleanError } from '../progress/model'
import { Button, EmptyState, IconButton, Panel, useAssistMenu } from '../ui'
import { formatMoment } from '../utils/dates'
import { currentPlan, planFromAssist, planKey } from './model'

/** Longest plan main accepts, in characters. */
const PLAN_MAX = 8000

/**
 * The recovery plan for these two checks: the section's one AI menu drafts it
 * (`fixes.recoveryPlan`), Save keeps a draft, and Edit (`?plan=edit`) changes the
 * saved text. Saved plans go through `fixes:saveRecoveryPlan`.
 */
export function RecoveryPlan({
  view,
  projectId,
  editing,
  assistClient,
  onEdit,
  onSave,
  onAnswer
}: {
  view: LostGroundView
  projectId: string
  editing: boolean
  assistClient?: AssistClient
  onEdit: (editing: boolean) => void
  onSave: (text: string, inputKey: string) => Promise<Plan>
  /** Main caches each answer as the plan, so the view reloads to show it. */
  onAnswer: () => void
}): JSX.Element {
  const plan = currentPlan(view)
  const inputKey = plan?.inputKey ?? planKey(view)
  const [error, setError] = useState<string | null>(null)
  const { menu, card } = useAssistMenu({
    label: 'AI actions for the recovery plan',
    scope: {
      projectId,
      pageId: view.pageId,
      marketId: view.now.marketId,
      ...(assistClient ? { client: assistClient } : {})
    },
    footer: 'Uses the two checks and page reads already saved. No new searches.',
    actions: [
      {
        assistId: 'fixes.recoveryPlan',
        label: plan ? 'Write the recovery plan again' : 'Write a recovery plan',
        seconds: 15,
        inputs: { vsRunId: view.before.runId },
        onResult: onAnswer,
        applyLabel: 'Save as the plan',
        onApply: (result, ids) => {
          setError(null)
          void onSave(planFromAssist(result, ids), inputKey).catch((cause: unknown) =>
            setError(cleanError(cause, 'Could not save the plan.'))
          )
        }
      }
    ]
  })
  return (
    <Panel
      title="Recovery plan"
      className="lg-plan"
      actions={
        <>
          {plan && !editing ? (
            <IconButton
              icon="pencil"
              size="sm"
              tip
              label="Edit the plan"
              onClick={() => onEdit(true)}
            />
          ) : null}
          {menu}
        </>
      }
    >
      {card}
      {error ? (
        <p className="bridge-alert" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? (
        <PlanEditor
          initial={plan?.text ?? ''}
          onCancel={() => onEdit(false)}
          onSave={async (text) => {
            await onSave(text, inputKey)
            onEdit(false)
          }}
        />
      ) : plan ? (
        <>
          <Markdown baseLevel={3} className="lg-plan-text">
            {plan.text}
          </Markdown>
          <p className="faint">
            {plan.edited ? 'Edited' : 'Written by CiteFox AI'} · saved {formatMoment(plan.savedAt)}
          </p>
        </>
      ) : (
        <EmptyState
          compact
          icon="sparkle"
          title="No recovery plan yet"
          body="Use the AI menu to draft one from these two checks, or write your own."
          action={
            <Button size="sm" onClick={() => onEdit(true)}>
              Write the plan
            </Button>
          }
        />
      )}
    </Panel>
  )
}

function PlanEditor({
  initial,
  onCancel,
  onSave
}: {
  initial: string
  onCancel: () => void
  onSave: (text: string) => Promise<void>
}): JSX.Element {
  const id = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  async function save(): Promise<void> {
    if (text.trim().length === 0) {
      setError('Write the plan first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(text.trim())
    } catch (cause) {
      setError(cleanError(cause, 'Could not save the plan.'))
      setBusy(false)
    }
  }

  return (
    <div className="lg-plan-edit">
      <label className="field-label" htmlFor={id}>
        The plan
      </label>
      <textarea
        ref={ref}
        id={id}
        className="ob-input"
        rows={8}
        maxLength={PLAN_MAX}
        value={text}
        placeholder="1. Bring back the sections in red, written for today’s page."
        onChange={(event) => setText(event.target.value)}
      />
      {error ? (
        <p className="bridge-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="fxp-confirm-actions">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save plan'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
