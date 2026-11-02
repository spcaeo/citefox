import type { AiContextPatch } from '../assistant/context/types'
import { connectionFacts } from '../connections/aiContext'
import type { StatusTab } from './focus'
import type { StatusData } from './types'

const TAB_LABEL: Readonly<Record<StatusTab, string>> = {
  connections: 'Connections',
  checks: 'Checks',
  usage: 'Usage',
  email: 'Email'
}

/**
 * What Ask CiteFox knows about Status: the open tab, the check queue and the
 * connections, as short facts. The KPI tiles add their own numbers.
 */
export function statusAiPatch(input: {
  tab: StatusTab
  data: StatusData | null
  openNotices: number
}): AiContextPatch {
  const { data } = input
  const queue = data?.queue ?? null
  const facts: string[] = []
  if (queue) {
    facts.push(
      `Check queue: ${queue.state.replace(/_/g, ' ')} · ${queue.running} running · ${queue.waiting} waiting · ${queue.pagesDue} pages due`
    )
    facts.push(
      `Background job: ${queue.headlessJob ? 'on' : 'off'} · tray ${queue.trayRunning ? 'on' : 'off'}`
    )
  }
  if (data?.jobs) facts.push(`Check jobs running: ${data.jobs.length}`)
  if (input.openNotices > 0) facts.push(`Decisions waiting: ${input.openNotices}`)
  if (data && data.errors.length > 0) facts.push(`Parts that could not load: ${data.errors.length}`)
  if (data?.overview)
    facts.push(...connectionFacts(data.overview, data.settings?.settings.claudeModel ?? null))
  return { filters: { tab: TAB_LABEL[input.tab] }, facts }
}
