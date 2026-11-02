import type {
  CheckFinishedNotice,
  CheckProgress,
  SetupProgress,
  SetupRunStep,
  StartProgress,
  TopicProgress
} from '@shared/ipc'
import type { StartClient } from './client'

/**
 * What CiteFox is doing and did in this window (owner feedback 4): one feed
 * from the progress streams (first-run setup, checks, page setup, topic steps),
 * newest last, at most {@link MAX_ACTIVITY} entries. A running line is replaced
 * by the next line with the same key, so a step shows once with its latest words.
 */

export const MAX_ACTIVITY = 100

export type ActivityArea = 'Setup' | 'Check' | 'Topic' | 'Pages' | 'Fixes'
export type ActivityState = 'running' | 'ok' | 'warning'

export interface ActivityEntry {
  key: string
  at: number
  area: ActivityArea
  text: string
  state: ActivityState
}

let entries: readonly ActivityEntry[] = []
const listeners = new Set<() => void>()
const fed = new WeakSet<StartClient>()
let unsubscribers: Array<() => void> = []

function emit(): void {
  for (const listener of listeners) listener()
}

/** Adds one line, replacing the newest line with the same key while that one is running. */
export function recordActivity(entry: ActivityEntry): void {
  const index = findLastIndex(entries, (item) => item.key === entry.key)
  const previous = index === -1 ? undefined : entries[index]
  let next: ActivityEntry[]
  if (previous !== undefined && previous.state === 'running') {
    next = entries.filter((_, at) => at !== index)
  } else if (
    previous !== undefined &&
    previous.text === entry.text &&
    previous.state === entry.state
  ) {
    return
  } else {
    next = [...entries]
  }
  next.push(entry)
  entries = next.slice(-MAX_ACTIVITY)
  emit()
}

function findLastIndex<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (test(list[index] as T)) return index
  }
  return -1
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function activitySnapshot(): readonly ActivityEntry[] {
  return entries
}

/** Tests only. */
export function resetActivityFeed(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
  entries = []
  emit()
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

/** "Fix 2 on /blog/x is working: 4 more searches cite it" (once per fix, from the ledger). */
export function fixWorkingLine(note: string): Omit<ActivityEntry, 'at'> {
  return { key: `fix-working:${note}`, area: 'Fixes', text: note, state: 'ok' }
}

/** First-run setup: the running step with its detail, else how it ended. */
export function startLine(progress: StartProgress): Omit<ActivityEntry, 'at'> {
  const key = `start:${progress.projectId}`
  if (progress.phase === 'done')
    return { key, area: 'Setup', text: 'Your site is ready', state: 'ok' }
  if (progress.phase === 'stopped')
    return { key, area: 'Setup', text: progress.message ?? 'Setup paused', state: 'warning' }
  if (progress.phase === 'failed')
    return { key, area: 'Setup', text: progress.message ?? 'Setup stopped', state: 'warning' }
  const item = progress.items.find((step) => step.state === 'running')
  const text = item
    ? item.detail
      ? `${item.label} · ${item.detail}`
      : item.label
    : 'Setting up your site'
  return { key, area: 'Setup', text, state: 'running' }
}

export function checkLine(progress: CheckProgress): Omit<ActivityEntry, 'at'> {
  const finished = progress.total > 0 && progress.done >= progress.total
  const state: ActivityState =
    progress.state === 'warning' || progress.state === 'error'
      ? 'warning'
      : finished
        ? 'ok'
        : 'running'
  const counted =
    progress.total > 0 ? `Checked ${progress.done} of ${progress.total} questions` : 'Checking'
  return {
    key: `check:${progress.jobId}`,
    area: 'Check',
    text: state === 'warning' && progress.detail ? `${counted} · ${progress.detail}` : counted,
    state
  }
}

export function checkFinishedLine(notice: CheckFinishedNotice): Omit<ActivityEntry, 'at'> {
  return {
    key: `check:${notice.jobId}`,
    area: 'Check',
    text: `Check finished · ${notice.pageLabel}: AI Overview on ${notice.aiosShown}, cited in ${notice.pageCited}`,
    state: 'ok'
  }
}

const SETUP_WORDS: Readonly<Record<SetupRunStep, string>> = {
  read: 'reading the page',
  profile: 'writing the buyer profile',
  prompts: 'writing questions',
  coverage: 'checking content gaps'
}

export function setupLine(progress: SetupProgress): Omit<ActivityEntry, 'at'> {
  const pages = progress.status.pages
  const ref = pages
    ? [...pages.running, ...pages.waiting, ...pages.doneToday, ...pages.failed].find(
        (page) => page.pageId === progress.pageId
      )
    : undefined
  const where = ref ? pathOf(ref.url) : 'a page'
  const key = `setup:${progress.pageId}`
  if (progress.state === 'done')
    return { key, area: 'Pages', text: `Page setup done for ${where}`, state: 'ok' }
  if (progress.state === 'failed')
    return {
      key,
      area: 'Pages',
      text: `Page setup stopped for ${where}: ${progress.message}`,
      state: 'warning'
    }
  if (progress.state === 'waiting')
    return { key, area: 'Pages', text: `Page setup waiting for ${where}`, state: 'running' }
  return {
    key,
    area: 'Pages',
    text: `Page setup: ${SETUP_WORDS[progress.step]} for ${where}`,
    state: 'running'
  }
}

export function topicLine(progress: TopicProgress): Omit<ActivityEntry, 'at'> {
  return {
    key: `topic:${progress.topicId ?? progress.draftId ?? progress.projectId}:${progress.step}`,
    area: 'Topic',
    text: progress.detail,
    state: progress.state === 'running' ? 'running' : progress.state === 'ok' ? 'ok' : 'warning'
  }
}

/** Starts the feed for this window once. Later calls with the same client do nothing. */
export function ensureActivityFeed(client: StartClient, now: () => number = Date.now): void {
  if (fed.has(client)) return
  fed.add(client)
  const add = (line: Omit<ActivityEntry, 'at'>): void => recordActivity({ ...line, at: now() })
  unsubscribers.push(
    client.onChanged((progress) => add(startLine(progress))),
    client.onCheckProgress((progress) => add(checkLine(progress))),
    client.onCheckFinished((notice) => add(checkFinishedLine(notice))),
    client.onSetupProgress((progress) => add(setupLine(progress))),
    client.onTopicProgress((progress) => add(topicLine(progress))),
    () => fed.delete(client)
  )
}
