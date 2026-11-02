import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { HistorySubject, ProjectCheck, StartCheckRequest } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useBuildTools } from '../../../buildMenu/buildClient'
import { copyText } from '../../../components/clipboard'
import { errorText } from '../../../components/errorText'
import { checkStartMessage } from '../../../m3/source'
import { marketLabel } from '../../../shell/model'
import { navigateHash, projectHash } from '../../../shell/routes'
import { Confirm, type MenuItem } from '../../../ui'
import { COPIED_MS } from '../../../ui/useCopyFeedback'
import { formatMoment } from '../../../utils/dates'
import type { ProjectHistorySource } from '../../client'
import {
  canRetry,
  checkHash,
  previousCheck,
  rerunQuestions,
  rerunRequest,
  retryRequest,
  searchCost
} from '../model'

/** A decision waiting in the small Confirm. */
type Pending =
  | { kind: 'rerun'; check: ProjectCheck }
  | { kind: 'retry'; check: ProjectCheck }
  | { kind: 'cancel'; check: ProjectCheck }
  | { kind: 'delete'; checks: readonly ProjectCheck[] }

export interface CheckActions {
  /** The row menu of one check. */
  menu: (check: ProjectCheck) => readonly MenuItem[]
  /** Asks, then deletes these checks (running ones are left alone). */
  askDelete: (checks: readonly ProjectCheck[]) => void
  /** The open Confirm, if any. */
  confirm: JSX.Element | null
}

/**
 * Check history's row actions (deep audit §2 b): open, compare with the one
 * before, re-run, retry the failed questions, stop a running check, copy its
 * link, and delete. A check runs until its job ends, so a re-run is started and
 * left to run: the toast says it started and then how it ended.
 */
export function useCheckActions({
  source,
  projectId,
  checks,
  subjects,
  markets,
  onCompare,
  onChanged,
  onDeleted
}: {
  source: ProjectHistorySource
  projectId: string
  /** Every check of the project, for "the one before". */
  checks: readonly ProjectCheck[]
  subjects: ReadonlyMap<string, HistorySubject>
  markets: ReadonlyMap<string, Market>
  onCompare: (older: ProjectCheck, newer: ProjectCheck) => void
  /** Reload the list (a check started, stopped or ended). */
  onChanged: () => void
  /** These run ids are gone: drop them from the selection. */
  onDeleted: (runIds: readonly string[]) => void
}): CheckActions {
  const { notify } = useBuildTools()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const nameOf = useCallback(
    (check: ProjectCheck): string => subjects.get(check.pageId)?.label ?? 'Removed page',
    [subjects]
  )
  const marketOf = useCallback(
    (check: ProjectCheck): string => {
      const market = markets.get(check.marketId)
      return market ? marketLabel(market) : 'a removed market'
    },
    [markets]
  )

  /** Fire and forget: `checks:start` resolves when the job ends. */
  const start = useCallback(
    (request: StartCheckRequest, what: string) => {
      notify(`${what} started. It runs in the background; this list updates as it goes.`, 'ok')
      source['checks:start'](request).then(
        (job) => {
          if (job.status === 'finished') notify(`${what} finished.`, 'ok')
          else notify(checkStartMessage(job), 'bad')
          onChanged()
        },
        (cause: unknown) => {
          notify(errorText(cause, 'The check did not start.'), 'bad')
          onChanged()
        }
      )
      // The new check shows as Running once the job has made its runs.
      window.setTimeout(onChanged, 800)
    },
    [notify, source, onChanged]
  )

  async function confirmPending(): Promise<void> {
    if (pending === null) return
    const current = pending
    if (current.kind === 'rerun') {
      setPending(null)
      start(rerunRequest(projectId, current.check), `Re-run of ${nameOf(current.check)}`)
      return
    }
    if (current.kind === 'retry') {
      setPending(null)
      start(retryRequest(projectId, current.check), `Retry of ${nameOf(current.check)}`)
      return
    }
    setBusy(true)
    try {
      if (current.kind === 'cancel') {
        await source['checks:cancel']({ jobId: current.check.jobId })
        notify('The check was stopped. Questions already checked keep their results.', 'ok')
      } else {
        const done: string[] = []
        for (const check of current.checks) {
          if (check.status === 'running') continue
          await source['history:delete']({ projectId, runId: check.runId })
          done.push(check.runId)
        }
        onDeleted(done)
        notify(`Deleted ${pluralize(done.length, 'check')}.`, 'ok')
      }
    } catch (cause) {
      notify(errorText(cause, 'That did not work. Try again.'), 'bad')
    } finally {
      setBusy(false)
      setPending(null)
      onChanged()
    }
  }

  const menu = (check: ProjectCheck): readonly MenuItem[] => {
    const subject = subjects.get(check.pageId)
    const previous = previousCheck(check, checks)
    const running = check.status === 'running'
    const items: MenuItem[] = [
      {
        id: 'open',
        label: running ? 'Open progress' : 'Open results',
        icon: 'eye',
        onSelect: () => navigateHash(checkHash(check, subject))
      },
      {
        id: 'compare',
        label: 'Compare with previous',
        icon: 'layers',
        disabled: previous === null,
        ...(previous === null ? { hint: 'First check' } : {}),
        onSelect: () => {
          if (previous !== null) onCompare(previous, check)
        }
      }
    ]
    if (!running) {
      items.push({
        id: 'rerun',
        label: 'Re-run',
        icon: 'refresh',
        groupStart: true,
        hint: searchCost(rerunQuestions(check), check.samples).replace('About ', ''),
        onSelect: () => setPending({ kind: 'rerun', check })
      })
    }
    if (canRetry(check)) {
      items.push({
        id: 'retry',
        label: `Retry ${pluralize(check.failedPromptIds.length, 'failed question')}`,
        icon: 'refresh',
        onSelect: () => setPending({ kind: 'retry', check })
      })
    }
    if (running) {
      items.push({
        id: 'cancel',
        label: 'Stop this check',
        icon: 'pause',
        groupStart: true,
        onSelect: () => setPending({ kind: 'cancel', check })
      })
    }
    items.push(
      {
        id: 'copy',
        label: copied === check.runId ? 'Link copied' : 'Copy link',
        icon: copied === check.runId ? 'check' : 'copy',
        tone: copied === check.runId ? 'ok' : 'default',
        keepOpen: true,
        groupStart: true,
        onSelect: () => {
          void copyText(projectHash(projectId, checkHash(check, subject))).then((ok) => {
            if (ok) setCopied(check.runId)
            else notify('Could not copy the link.', 'bad')
          })
        }
      },
      {
        id: 'delete',
        label: 'Delete check',
        icon: 'trash',
        tone: 'danger',
        disabled: running,
        ...(running ? { hint: 'Running' } : {}),
        onSelect: () => setPending({ kind: 'delete', checks: [check] })
      }
    )
    return items
  }

  const askDelete = useCallback((selected: readonly ProjectCheck[]) => {
    const ended = selected.filter((check) => check.status !== 'running')
    if (ended.length > 0) setPending({ kind: 'delete', checks: ended })
  }, [])

  return {
    menu,
    askDelete,
    confirm: pending === null ? null : confirmFor(pending)
  }

  function confirmFor(current: Pending): JSX.Element {
    const close = (): void => setPending(null)
    const run = (): void => void confirmPending()
    if (current.kind === 'delete') {
      const [one] = current.checks
      const title =
        current.checks.length === 1 && one !== undefined
          ? `Delete the ${formatMoment(one.startedAt)} check?`
          : `Delete ${pluralize(current.checks.length, 'check')}?`
      return (
        <Confirm
          title={title}
          body={`${current.checks.length === 1 ? 'Its results leave' : 'Their results leave'} history and trends. Searches already used are not refunded.`}
          confirmLabel={current.checks.length === 1 ? 'Delete check' : 'Delete checks'}
          busy={busy}
          onConfirm={run}
          onCancel={close}
          testId="history-delete-confirm"
        />
      )
    }
    const check = current.check
    if (current.kind === 'cancel') {
      return (
        <Confirm
          title="Stop this check?"
          body="It stops the whole check job it belongs to. Questions already checked keep their results."
          confirmLabel="Stop check"
          busy={busy}
          onConfirm={run}
          onCancel={close}
          testId="history-cancel-confirm"
        />
      )
    }
    const questions =
      current.kind === 'retry' ? check.failedPromptIds.length : rerunQuestions(check)
    const cost = searchCost(questions, check.samples)
    return (
      <Confirm
        title={
          current.kind === 'retry'
            ? `Retry ${pluralize(questions, 'failed question')}?`
            : `Re-run the ${formatMoment(check.startedAt)} check?`
        }
        body={`Checks ${nameOf(check)} in ${marketOf(check)} again with ${current.kind === 'retry' ? 'the' : 'the same'} ${pluralize(questions, 'question')}. ${cost.replace('About', 'Uses about')}.`}
        confirmLabel={current.kind === 'retry' ? 'Retry questions' : 'Re-run check'}
        tone="default"
        onConfirm={run}
        onCancel={close}
        testId="history-rerun-confirm"
      />
    )
  }
}
