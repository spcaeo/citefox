import {
  SETUP_PROGRESS_CHANNEL,
  type AssistProgress,
  type CheckFinishedNotice,
  type CheckProgress,
  type ExportProgress,
  type PageReadProgress,
  type SetupProgress,
  type StartProgress,
  type TopicProgress
} from '@shared/ipc'
import { ENGINE_IDS, ENGINE_LABEL, TOPIC_STAGE_LABEL, type EngineId } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import type { ConsoleLive, ConsoleLiveRow, ConsoleUpdate, JobKind, LineState } from './types'

/**
 * Every progress stream the app already pushes, turned into console updates
 * (pure functions; the store subscribes and stamps the time):
 *
 * - `checks:progress` / `checks:finished`: checks, manual and scheduled;
 * - `pages:readProgress`: page reads;
 * - `assist:progress`: every AI step (fill from website, assists, topic wizard
 *   generation, buyer profiles, page setup's reads and Claude calls);
 * - `topics:progress`, `setup:progress`, `start:changed`, `exports:progress`.
 *
 * Words are short and plain, like the mock-up: "search the web, US".
 */

/** Usual length of a fill from website (four pages, a read, a web search per product). */
const FILL_EXPECTED_MS = 90_000

function upper(value: string): string {
  return value
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-|-$/gu, '')
    .toUpperCase()
}

const CHECK_STATE: Readonly<Record<CheckProgress['state'], LineState>> = {
  waiting: 'running',
  running: 'running',
  ok: 'running',
  warning: 'warning',
  error: 'error'
}

/** "8 questions and 4 keywords" when a topic has both, else "12 questions". */
function checkScope(progress: CheckProgress): string {
  const mix = progress.mix
  if (mix !== undefined && mix.keywords > 0) {
    return `${pluralize(mix.questions, 'question')} and ${pluralize(mix.keywords, 'keyword')}`
  }
  return pluralize(progress.total, 'question')
}

/** What the check is doing now, in plain words. */
function checkActivity(progress: CheckProgress): string {
  // A rate limit has the check running slower: say so, and that nothing is lost.
  if (progress.slowedNotice !== undefined) return progress.slowedNotice
  // Several questions at once: one question's words would hide the others.
  if ((progress.inFlight ?? 0) > 1 && progress.phase !== 'reread') {
    return `searching ${progress.inFlight}`
  }
  if (progress.phase === 'search' && progress.state === 'running') {
    // "Searching Google for "nagios email to text not working""
    return progress.promptText ? `${progress.detail} for "${progress.promptText}"` : progress.detail
  }
  if (progress.phase === 'search') return 'Reading the AI Overview'
  if (progress.phase === 'aio') {
    return progress.detail === 'No AI Overview'
      ? 'No AI Overview for this one'
      : 'Reading the AI Overview'
  }
  if (progress.phase === 'analysis') return 'Scoring'
  return progress.detail
}

/** Credits spent so far (searches when the job counts no credits). */
function spendText(progress: CheckProgress): string {
  if ((progress.creditsUsed ?? 0) > 0)
    return `${pluralize(progress.creditsUsed ?? 0, 'credit')} used`
  if (progress.searchesUsed > 0)
    return `${pluralize(progress.searchesUsed, 'search', 'searches')} used`
  return ''
}

/** "Google AI Overview, ChatGPT and Perplexity". */
function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/**
 * What the check is for, in one sentence: "Asking Google AI Overview and ChatGPT each
 * buyer question, to see whether they cite example.com."
 */
export function checkPurpose(progress: CheckProgress): string | null {
  const asked = new Set<EngineId>(
    (progress.inFlightItems ?? []).flatMap((item) => item.engines.map((entry) => entry.engine))
  )
  const engines = ENGINE_IDS.filter((engine) => asked.has(engine))
  if (engines.length === 0) return null
  const mix = progress.mix
  const each =
    mix !== undefined && mix.keywords > 0
      ? mix.questions > 0
        ? 'each buyer question and keyword'
        : 'each keyword'
      : 'each buyer question'
  const cite = engines.length === 1 ? 'it cites' : 'they cite'
  const names = listWords(engines.map((engine) => ENGINE_LABEL[engine]))
  return `Asking ${names} ${each}, to see whether ${cite} ${progress.domain ?? 'your site'}.`
}

const ENGINE_STATE = {
  cited: 'cited',
  named: 'ok',
  not_cited: 'ok',
  no_answer: 'ok',
  unavailable: 'failed',
  error: 'failed'
} as const

/**
 * The questions a check runs side by side (owner, 2026-10-29): one row each with its
 * number, stage, words and engines, and the one scored last. Null for a check of a
 * single question (its stage line says it all) and once the check is over.
 */
export function checkLive(progress: CheckProgress, final: boolean): ConsoleLive | null {
  if (final || progress.total <= 1) return null
  const label = (item: { kind: string; number: number }): string =>
    `${item.kind === 'keyword' ? 'K' : 'Q'}${item.number}`
  const rows = (progress.inFlightItems ?? []).map((item): ConsoleLiveRow => ({
    id: `${item.pageId}:${item.marketId}:${item.promptId}`,
    label: label(item),
    stage: item.stage ? TOPIC_STAGE_LABEL[item.stage] : null,
    text: item.text,
    engines: item.engines.map((entry) => ({
      name: ENGINE_LABEL[entry.engine],
      state: entry.status === null ? 'waiting' : ENGINE_STATE[entry.status]
    })),
    startedAt: Date.parse(item.startedAt)
  }))
  const done = progress.lastDone
  if (rows.length === 0 && done === undefined) return null
  return {
    purpose: checkPurpose(progress),
    rows,
    lastDone:
      done === undefined
        ? null
        : {
            id: `${done.pageId}:${done.marketId}:${done.promptId}`,
            label: label(done),
            cited: done.cited,
            at: Date.parse(done.finishedAt)
          }
  }
}

/**
 * A check: the page re-read, then each question in plain words ("Searching Google
 * for "…"", "Reading the AI Overview", "Scoring") with "3 of 12" and the credits so far.
 * While several questions run at once it says how many ("6 of 12 done · searching 3"),
 * and the window lists them under that line (`checkLive`).
 */
export function fromCheckProgress(progress: CheckProgress, at: number): ConsoleUpdate {
  const final = progress.total > 0 && progress.done >= progress.total
  const state = CHECK_STATE[progress.state]
  const failed = state === 'error' || state === 'warning'
  const stage = progress.phase === 'reread' ? 'READ' : 'SEARCH'
  const keywords = (progress.mix?.keywords ?? 0) > 0
  const counted =
    progress.total > 0
      ? `${progress.done} of ${progress.total} ${keywords ? 'done' : 'questions'}`
      : ''
  return {
    jobId: `check:${progress.jobId}`,
    kind: 'checks',
    title: 'Check',
    command: progress.total > 0 ? `check ${checkScope(progress)}` : 'check',
    at,
    stage,
    stageText:
      stage === 'READ'
        ? 'Re-reading the page'
        : // The activity goes last: the log adds "… please wait" after it.
          [counted, spendText(progress), failed ? '' : checkActivity(progress)]
            .filter(Boolean)
            .join(' · '),
    progress: progress.total > 0 ? { done: progress.done, total: progress.total } : null,
    state: final ? (failed ? state : 'ok') : state,
    final,
    ...(final
      ? {
          summary: keywords
            ? `${progress.done} of ${progress.total} checked (${checkScope(progress)})`
            : `${progress.done} of ${progress.total} questions checked`
        }
      : {}),
    ...(failed
      ? {
          error: { message: progress.detail, nextStep: progress.nextStep },
          retry: { kind: 'check' as const, projectId: progress.projectId, pageId: progress.pageId }
        }
      : {}),
    stop: final ? null : { kind: 'check', jobId: progress.jobId },
    live: checkLive(progress, final),
    settleMs: 60_000
  }
}

export function fromCheckFinished(notice: CheckFinishedNotice, at: number): ConsoleUpdate {
  return {
    jobId: `check:${notice.jobId}`,
    kind: 'checks',
    title: 'Check',
    command: 'check',
    at,
    step: {
      id: `finished:${notice.pageId}:${notice.marketId}`,
      text: `${notice.pageLabel}: AI Overview on ${notice.aiosShown}, cited in ${notice.pageCited}`,
      state: 'ok',
      detail: null,
      startedAt: at,
      endedAt: at
    },
    state: 'ok'
  }
}

/** A page read: fetch, extract, summary. A warning is the read failing. */
export function fromPageRead(progress: PageReadProgress, at: number): ConsoleUpdate {
  const failed = progress.state === 'warning'
  const final = failed || (progress.phase === 'summary' && progress.state === 'ok')
  return {
    jobId: `read:${progress.pageId}`,
    kind: 'pages',
    title: 'Page read',
    command: 'read page',
    at,
    stage: upper(progress.phase),
    stageText: progress.detail.replace(/\.$/u, '').toLowerCase(),
    state: failed ? 'error' : progress.state === 'running' ? 'running' : 'ok',
    final,
    ...(final && !failed ? { summary: 'page read' } : {}),
    ...(failed ? { error: { message: progress.detail, nextStep: progress.nextStep } } : {})
  }
}

const ASSIST_STAGE: Readonly<Record<AssistProgress['kind'], { stage: string; text: string }>> = {
  read: { stage: 'READ', text: 'Reading your pages' },
  cache: { stage: 'READ', text: 'Reading your pages' },
  claude: { stage: 'CLAUDE', text: 'Asking CiteFox AI' },
  check: { stage: 'CHECK', text: 'Checking the answer' },
  result: { stage: 'RESULT', text: 'Getting the results ready' },
  work: { stage: 'WORK', text: 'Working' }
}

const ASSIST_STATE: Readonly<Record<AssistProgress['state'], LineState>> = {
  running: 'running',
  done: 'ok',
  skipped: 'skipped',
  failed: 'error'
}

/** Names for the invoke channels that run AI steps. Others read from the channel name. */
const CHANNEL_TITLES: Readonly<Record<string, string>> = {
  'assist:run': 'AI suggestion',
  'start:homework': 'Reading your site',
  'buyerProfile:generate': 'Buyer profile',
  'prompts:generate': 'Buyer questions',
  'pages:readStart': 'Page read',
  'projects:searchProductCompetitors': 'Competitor search',
  [SETUP_PROGRESS_CHANNEL]: 'Page setup'
}

/** AI steps CiteFox runs on its own when a screen loads; the user did not ask for them. */
const BACKGROUND_CHANNELS: ReadonlySet<string> = new Set([
  'topics:suggestedStart',
  'competitors:sortSites'
])

function channelKind(channel: string): JobKind {
  if (channel === 'projects:fillFromWebsite' || channel === 'projects:searchProductCompetitors') {
    return 'fill'
  }
  if (channel === SETUP_PROGRESS_CHANNEL) return 'setup'
  if (channel.startsWith('topics:')) return 'topics'
  if (channel.startsWith('pages:')) return 'pages'
  if (channel.startsWith('start:')) return 'start'
  return 'ai'
}

function channelTitle(channel: string, scope: string | null): string {
  if (channel === 'projects:fillFromWebsite') return scope ? `Fill from ${scope}` : 'Fill'
  const known = CHANNEL_TITLES[channel]
  if (known) return known
  const [area = '', name = ''] = channel.split(':')
  const words = name.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()
  const head = area.charAt(0).toUpperCase() + area.slice(1)
  return words ? `${head} · ${words}` : head || 'Work'
}

/** One AI step (`assist:progress`): a prompt line per kind of step, the step under it. */
export function fromAssist(event: AssistProgress, at: number): ConsoleUpdate {
  const kind = channelKind(event.channel)
  const stage = ASSIST_STAGE[event.kind]
  const state = ASSIST_STATE[event.state]
  const jobId =
    kind === 'setup' && event.scope
      ? `setup:${event.scope}`
      : kind === 'fill' && event.scope
        ? `fill:${event.scope}`
        : `ai:${event.runId}`
  const title = channelTitle(event.channel, event.scope)
  const final = event.kind === 'result' && event.state === 'done'
  const detail = event.detail ?? (event.claude ? event.claude.connectionText : null)
  return {
    jobId,
    kind,
    title,
    command:
      kind === 'fill' && event.scope
        ? `fill ${event.scope}`
        : title.toLowerCase().replace(' · ', ' '),
    at,
    stage: stage.stage,
    stageText: stage.text,
    step: {
      id: `${event.runId}:${event.stepId}`,
      text: event.label,
      state,
      detail,
      startedAt: event.startedAt,
      endedAt: event.endedAt
    },
    state: state === 'running' ? 'running' : state === 'error' ? 'error' : 'ok',
    final,
    ...(final ? { summary: event.label } : {}),
    ...(state === 'error'
      ? {
          error: {
            message: `${event.label}${event.detail ? `: ${event.detail}` : ''}`,
            nextStep: null
          }
        }
      : {}),
    ...(kind === 'fill' ? { expectedMs: FILL_EXPECTED_MS } : {}),
    ...(event.channel === 'pages:readStart' ? { attachTo: 'pages' as const } : {}),
    ...(BACKGROUND_CHANNELS.has(event.channel) ? { background: true } : {})
  }
}

/** A topic wizard step: one prompt line per step, "3 of 8" as it goes. */
export function fromTopicProgress(progress: TopicProgress, at: number): ConsoleUpdate {
  const key = progress.topicId ?? progress.draftId ?? progress.projectId
  return {
    jobId: `topic:${key}`,
    kind: 'topics',
    title: 'Topic',
    command: 'topic',
    at,
    stage: upper(progress.step),
    stageText: [progress.detail, progress.total > 1 ? `${progress.done} of ${progress.total}` : '']
      .filter(Boolean)
      .join(' · '),
    progress: progress.total > 1 ? { done: progress.done, total: progress.total } : null,
    state: progress.state === 'running' ? 'running' : progress.state === 'ok' ? 'ok' : 'warning',
    ...(progress.state === 'warning'
      ? { error: { message: progress.detail, nextStep: null } }
      : {}),
    settleMs: 4000
  }
}

/** Background page setup: read, profile, prompts, gaps. Failed pages can be retried. */
export function fromSetupProgress(progress: SetupProgress, at: number): ConsoleUpdate {
  const failed = progress.state === 'failed'
  const final = failed || progress.state === 'done'
  return {
    jobId: `setup:${progress.pageId}`,
    kind: 'setup',
    title: 'Page setup',
    command: 'set up page',
    at,
    stage: upper(progress.step),
    stageText: progress.message,
    state: failed ? 'error' : final ? 'ok' : 'running',
    final,
    ...(final && !failed ? { summary: 'page set up' } : {}),
    ...(failed
      ? {
          error: { message: progress.message, nextStep: null },
          retry: { kind: 'setup' as const, pageId: progress.pageId }
        }
      : {})
  }
}

/** First-run setup ("Setting up your site"): the running step, then how it ended. */
export function fromStartProgress(progress: StartProgress, at: number): ConsoleUpdate {
  const running = progress.items.find((item) => item.state === 'running')
  const final = progress.phase !== 'running'
  const failed = progress.phase === 'failed'
  const doneCount = progress.items.filter((item) => item.state === 'ok').length
  return {
    jobId: `start:${progress.projectId}`,
    kind: 'start',
    title: 'Setting up your site',
    command: 'set up site',
    at,
    ...(running
      ? {
          stage: upper(running.id),
          stageText: running.detail ? `${running.label} · ${running.detail}` : running.label
        }
      : {}),
    progress: progress.items.length > 0 ? { done: doneCount, total: progress.items.length } : null,
    state: failed ? 'error' : final ? 'ok' : 'running',
    final,
    ...(final
      ? {
          summary:
            progress.phase === 'done'
              ? 'your site is ready'
              : (progress.message ?? (failed ? 'setup stopped' : 'setup paused'))
        }
      : {}),
    ...(failed ? { error: { message: progress.message ?? 'Setup stopped.', nextStep: null } } : {}),
    stop: final ? null : { kind: 'start', projectId: progress.projectId },
    ...(progress.etaSeconds !== null
      ? { expectedMs: progress.elapsedMs + progress.etaSeconds * 1000 }
      : {}),
    settleMs: 30_000
  }
}

/** An export: collect, render, write. A warning is the export failing. */
export function fromExportProgress(progress: ExportProgress, at: number): ConsoleUpdate {
  const failed = progress.state === 'warning'
  const final = failed || (progress.phase === 'write' && progress.state === 'ok')
  return {
    jobId: `export:${progress.exportId}`,
    kind: 'exports',
    title: 'Export',
    command: 'export',
    at,
    stage: upper(progress.phase),
    stageText: progress.detail,
    progress: progress.total > 0 ? { done: progress.done, total: progress.total } : null,
    state: failed ? 'error' : progress.state === 'running' ? 'running' : 'ok',
    final,
    ...(final && !failed ? { summary: 'file written' } : {}),
    ...(failed ? { error: { message: progress.detail, nextStep: progress.nextStep } } : {})
  }
}
