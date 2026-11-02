import type { LlmCallRecord } from '@shared/ipc'
import { readLlmUsage } from '../../llm/usage'
import { monthKey } from '../../scheduler/local-time'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { getProject, listApiKeys, listConnectionEventsForKey } from '../../storage/records'
import type { AssistContext, AssistDefinition } from '../types'
import { clip } from './gather'

/** Status assists. They need no project and read app-wide saved data only. */

const RECENT_EVENTS = 8

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function projectName(context: AssistContext, projectId: string | null): string {
  if (projectId === null) return 'no project'
  return getProject(context.host.storage.db, projectId)?.name ?? 'a removed project'
}

function callLine(context: AssistContext, row: LlmCallRecord): string {
  const step = row.assistId ?? row.templateKind ?? row.source
  const error = row.error === null ? '' : `: ${clip(row.error, 300)}`
  return `${row.startedAt} · ${step} · ${row.connection} · ${projectName(context, row.projectId)}${error}`
}

export const STATUS_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'status.explainUsage',
    title: 'Explain my usage',
    expectedSeconds: 6,
    acceptsInstruction: true,
    needsProject: false,
    minItems: 1,
    maxItems: 6,
    task: `Explain this month's usage in plain words for someone who is not technical: Claude calls and tokens, which steps used them, and SerpApi searches against each key's cap and plan.
Say what uses searches (checks) and what does not (every assist and Ask CiteFox use saved data only).
summary is two or three sentences. One item per point: text is the point, detail gives the numbers, tag is Claude or SerpApi.`,
    gather(context) {
      const now = context.host.now()
      const usage = readLlmUsage(context.host.storage, { now })
      const month = monthKey(now.getTime(), localZone())
      const searches = getKeyUsageForMonth(context.host.storage.db, month)
      const keys = listApiKeys(context.host.storage.db)
      const steps = usage.byStep
        .slice(0, 10)
        .map(
          (step) =>
            `${step.step}: ${step.calls} calls, ${step.failed} failed, about ${Math.round(step.averageDurationMs / 1000)} s each`
        )
        .join('\n')
      const connections = usage.byConnection
        .map(
          (row) =>
            `${row.connection}: ${row.calls} calls, ${row.tokensIn} tokens in, ${row.tokensOut} tokens out`
        )
        .join('\n')
      const keyLines = keys
        .filter((key) => key.provider === 'serpapi')
        .map((key) => {
          const used = searches.keys.find((row) => row.keyId === key.id)?.searches ?? 0
          const plan =
            key.serpapiUsage === null
              ? ''
              : `; SerpApi account reports ${key.serpapiUsage.used} used of ${key.serpapiUsage.planLimit ?? 'an unknown number'} (${key.serpapiUsage.plan ?? 'plan not reported'})`
          return `Key "${key.name}" (${key.on ? 'on' : 'off'}, ${key.state}): ${used} searches by CiteFox this month, cap ${key.cap ?? 'none'}${plan}`
        })
        .join('\n')
      const byProject = new Map<string, number>()
      for (const key of searches.keys) {
        for (const row of key.projects) {
          const name = projectName(context, row.projectId)
          byProject.set(name, (byProject.get(name) ?? 0) + row.searches)
        }
      }
      return [
        `Month: ${month}`,
        `Claude calls today: ${usage.callsToday} (${usage.failedToday} failed). This month: ${usage.callsThisMonth}.`,
        `Tokens this month: ${usage.tokensInThisMonth} in, ${usage.tokensOutThisMonth} out.`,
        'By connection:',
        connections || 'No Claude calls this month.',
        'By step:',
        steps || 'none',
        '',
        `SerpApi searches this month: ${searches.totals.searches}.`,
        'By key:',
        keyLines || 'No SerpApi key saved.',
        'By project:',
        [...byProject.entries()].map(([name, count]) => `${name}: ${count}`).join('\n') || 'none'
      ].join('\n')
    }
  },
  {
    id: 'status.explainErrors',
    title: 'Explain recent errors',
    expectedSeconds: 6,
    acceptsInstruction: true,
    needsProject: false,
    minItems: 0,
    maxItems: 8,
    task: `Explain the recent failed Claude calls and connection problems below in plain words, and give the next step for each.
Group repeats of the same problem into one item. One item per problem: text says what went wrong, detail is the next step (such as "Run claude in Terminal and sign in again" or "Raise the key's cap on Connections"), tag is Claude or SerpApi.
When nothing failed, give no items and say so in summary.`,
    gather(context) {
      const usage = readLlmUsage(context.host.storage, { now: context.host.now() })
      const failed = usage.recentErrors.map((row) => callLine(context, row)).join('\n')
      const keys = listApiKeys(context.host.storage.db)
      const keyLines = keys
        .filter((key) => key.state !== 'ok' && key.state !== 'unchecked')
        .map(
          (key) =>
            `Key "${key.name}" (${key.provider}): ${key.state}, last reason ${key.lastReason ?? 'none'}`
        )
        .join('\n')
      const events = keys
        .flatMap((key) =>
          listConnectionEventsForKey(context.host.storage.db, key.id).map((event) => ({
            key,
            event
          }))
        )
        .sort((left, right) => right.event.at.localeCompare(left.event.at))
        .slice(0, RECENT_EVENTS)
        .map(
          ({ key, event }) =>
            `${event.at} · key "${key.name}" (${key.provider}) · ${event.kind}${event.detail === null ? '' : `: ${clip(event.detail, 200)}`}`
        )
        .join('\n')
      return [
        'Failed Claude calls this month (newest first):',
        failed || 'none',
        '',
        'Keys with a problem:',
        keyLines || 'none',
        '',
        'Recent connection events:',
        events || 'none'
      ].join('\n')
    }
  }
]
