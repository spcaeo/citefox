// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import type { FillFromWebsiteResult, SetupSectionId, SetupSectionResult } from '@shared/ipc'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ASSIST_OUTPUT_RULES, SITE_READ_RULES } from '../assist/preamble'
import { SITE_READ_ASSIST_ID } from '../engine/fill-from-website'
import { siteKey } from '../engine/site-outline'
import { toContext, type EngineContext } from '../handlers/context'
import { projectsHandlers } from '../handlers/projects'
import { createLogger, redactString } from '../logging'
import { runSection } from '../onboarding/sections/service'
import { sectionAssistId } from '../onboarding/sections/registry'
import { locateClaudeBinary } from '../providers'
import { createFsBinaryProbe } from '../providers/claude/binary'
import { createClaudeCodeProvider } from '../providers/claude/claude-code'
import { scrubClaudeEnv } from '../providers/claude/env'
import { limitWords } from '../providers/claude/problems'
import { claudeCodePause } from '../providers/claude/shared-gate'
import { createSpawnCommandTransport } from '../providers/command'
import { createFetchHttpTransport, type HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage'
import { AUTO_SECTIONS, CARD_SECTIONS, type EvalArgs } from './args'
import { applyFill, applySection, contextFor, emptyDraft, type EvalDraft } from './draft'
import { recordCalls, type CallRecorder, type RecordedCall } from './recorder'
import { summaryMarkdown } from './summary'

/**
 * The bench run: one engine host on temp storage under the out folder, the real
 * `projects:fillFromWebsite` read (step 3), then each section through the real
 * `runSection`, chained the way the setup screens chain them. Sites one at a time;
 * Claude Code's own gate keeps calls to 2 at once. A usage limit stops the run.
 */

export interface EvalIo {
  log(line: string): void
}

export type SectionStatus = 'ok' | 'empty' | 'fail' | 'skipped'

export interface SectionRecord {
  section: SetupSectionId
  phase: 'auto' | 'card'
  status: SectionStatus
  durationMs: number
  error: string | null
  warnings: readonly string[]
  /** The context the section was given (what earlier steps found). */
  context: unknown
  /** The exact prompt sent (routing line included) and the raw reply. */
  prompt: string | null
  reply: string | null
  rows: SetupSectionResult['rows']
  text: string | null
  calls: readonly RecordedCall[]
}

export interface ReadRecord {
  status: 'ok' | 'unreadable' | 'fail'
  durationMs: number
  message: string | null
  pagesRead: FillFromWebsiteResult['pagesRead']
  pages: readonly { path: string; title: string }[]
  menu: readonly { text: string; path: string }[]
  /** The page text the site-read prompt carried, each page starting with its path. */
  pageText: string | null
  result: Omit<FillFromWebsiteResult, 'pagesRead' | 'domain' | 'message' | 'nextStep'> | null
  calls: readonly RecordedCall[]
}

export interface SiteRecord {
  domain: string
  label: string
  country: string
  language: string
  startedAt: string
  durationMs: number
  read: ReadRecord
  sections: SectionRecord[]
  /** Why the run stopped on this site (a Claude limit), or null. */
  stopped: string | null
}

export interface EvalRunResult {
  dir: string
  sites: SiteRecord[]
  calls: number
  durationMs: number
  stopped: string | null
}

const PAGES_MARKER = 'The pages read, each starting with its path:\n\n'
/** Paid search hosts: the bench never calls them. */
const PAID_HOSTS = /(?:^|\.)(?:serpapi\.com|cloro\.dev|cloro\.ai)$/iu

export async function runPromptEval(args: EvalArgs, io: EvalIo): Promise<EvalRunResult> {
  const dir = join(args.out, args.label)
  const dataDir = join(dir, '.data')
  mkdirSync(dataDir, { recursive: true })
  const progressPath = join(dir, 'progress.log')
  const say = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}`
    appendFileSync(progressPath, `${stamped}\n`)
    io.log(stamped)
  }
  const logger = createLogger({
    write: (_level, line) => appendFileSync(join(dir, 'app.log'), `${line}\n`),
    secrets: () => []
  })
  const probe = createFsBinaryProbe()
  const located = locateClaudeBinary(null, probe, {
    home: homedir(),
    platform: process.platform,
    pathEnv: process.env.PATH
  })
  if (located.path === null) throw new Error('Claude Code was not found on PATH.')
  const command = createSpawnCommandTransport()
  const recorder = recordCalls(
    createClaudeCodeProvider({
      command,
      probe,
      logger,
      savedBinaryPath: located.path,
      // Never an API key or token: calls run on this computer's Claude Code login.
      baseEnv: scrubClaudeEnv(process.env),
      secrets: () => [],
      home: homedir(),
      platform: process.platform,
      pathEnv: process.env.PATH
    })
  )
  const started = Date.now()
  const sites: SiteRecord[] = []
  let stopped: string | null = null
  let storage: AppStorage | null = null
  let ctx: EngineContext | null = null
  say(`run ${args.label}: ${args.sites.length} sites, sections ${args.sections.join(',')}`)
  try {
    storage = openAppStorage(dataDir)
    ctx = toContext({
      appInfo: () => ({ name: 'CiteFox', version: 'prompt-eval' }),
      storage,
      secrets: new MemorySecretStore(new SecretRegistry()),
      logger,
      http: noPaidSearch(createFetchHttpTransport()),
      claudeCommand: command,
      claudeProbe: probe,
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [],
      claude: recorder.provider
    })
    for (const [index, domain] of args.sites.entries()) {
      say(`site ${index + 1}/${args.sites.length} ${domain}: start`)
      const record = await runSite(ctx, recorder, args, domain, say)
      sites.push(record)
      writeJson(join(dir, `${domain}.json`), record)
      writeFileSync(
        join(dir, 'summary.md'),
        summaryMarkdown(args, sites, recorder.count(), Date.now() - started, record.stopped)
      )
      say(`site ${domain}: done in ${seconds(record.durationMs)}, calls so far ${recorder.count()}`)
      if (record.stopped !== null) {
        stopped = record.stopped
        say(`STOPPED: ${stopped}`)
        break
      }
    }
  } finally {
    try {
      ctx?.email.close()
    } catch {
      // Closing the temp email store should not hide the result.
    }
    try {
      storage?.close()
    } catch {
      // Closing the temp database should not hide the result.
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
  const durationMs = Date.now() - started
  writeFileSync(
    join(dir, 'summary.md'),
    summaryMarkdown(args, sites, recorder.count(), durationMs, stopped)
  )
  say(`run done: ${sites.length} sites, ${recorder.count()} Claude calls, ${seconds(durationMs)}`)
  return { dir, sites, calls: recorder.count(), durationMs, stopped }
}

async function runSite(
  ctx: EngineContext,
  recorder: CallRecorder,
  args: EvalArgs,
  domain: string,
  say: (line: string) => void
): Promise<SiteRecord> {
  const started = Date.now()
  const record: SiteRecord = {
    domain,
    label: args.label,
    country: args.country,
    language: args.language,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    read: await readSite(ctx, recorder, args, domain),
    sections: [],
    stopped: null
  }
  say(
    `site ${domain}: read ${record.read.status} in ${seconds(record.read.durationMs)} (${record.read.pages.length} pages, ${record.read.calls.length} calls)${record.read.message ? ` · ${record.read.message}` : ''}`
  )
  record.stopped = limitReason()
  const finish = (): SiteRecord => ({ ...record, durationMs: Date.now() - started })
  if (record.read.status !== 'ok' || record.stopped !== null || record.read.result === null) {
    record.sections = args.sections.map((section) => skipped(section, phaseOf(section)))
    return finish()
  }
  let draft = applyFill(emptyDraft(domain, args.country, args.language), {
    ...record.read.result,
    domain,
    pagesRead: [],
    message: '',
    nextStep: null
  })
  for (const section of AUTO_SECTIONS) {
    if (!args.sections.includes(section)) continue
    if (record.stopped !== null) {
      record.sections.push(skipped(section, 'auto'))
      continue
    }
    const done = await runOne(ctx, recorder, draft, section, 'auto')
    record.sections.push(done.record)
    draft = done.draft
    say(`site ${domain}: ${section} ${done.record.status} in ${seconds(done.record.durationMs)}`)
    record.stopped = limitReason()
  }
  // The cards a user can ✦ Redo, each on the auto path's context; Claude's gate runs 2 at once.
  const cards = CARD_SECTIONS.filter((section) => args.sections.includes(section))
  if (record.stopped !== null) {
    record.sections.push(...cards.map((section) => skipped(section, 'card')))
    return finish()
  }
  const base = draft
  const results = await Promise.all(
    cards.map(async (section) => {
      const done = await runOne(ctx, recorder, base, section, 'card')
      say(
        `site ${domain}: ${section} (card) ${done.record.status} in ${seconds(done.record.durationMs)}`
      )
      return done.record
    })
  )
  record.sections.push(...results)
  record.stopped = limitReason()
  return finish()
}

async function readSite(
  ctx: EngineContext,
  recorder: CallRecorder,
  args: EvalArgs,
  domain: string
): Promise<ReadRecord> {
  const mark = recorder.count()
  const started = Date.now()
  let fill: FillFromWebsiteResult | null = null
  let error: string | null = null
  try {
    fill = await projectsHandlers(ctx)['projects:fillFromWebsite']({
      projectId: null,
      domain,
      market: { country: args.country, language: args.language }
    })
  } catch (cause) {
    error = errorText(cause)
  }
  const calls = recorder.since(mark)
  const siteRead = calls.filter((call) => call.assistId === SITE_READ_ASSIST_ID).at(-1)
  const outline = ctx.memory.siteOutlines.get(siteKey(domain))
  const readable = (fill?.pagesRead ?? []).some((page) => page.ok)
  const status: ReadRecord['status'] = !readable
    ? 'unreadable'
    : fill === null || fill.nextStep !== null
      ? 'fail'
      : 'ok'
  return {
    status,
    durationMs: Date.now() - started,
    message: error ?? (status === 'ok' ? null : (fill?.message ?? null)),
    pagesRead: fill?.pagesRead ?? [],
    pages: outline?.pages ?? [],
    menu: outline?.menu ?? [],
    pageText: siteRead === undefined ? null : pageTextOf(siteRead.prompt),
    result: fill === null ? null : readResult(fill),
    calls
  }
}

async function runOne(
  ctx: EngineContext,
  recorder: CallRecorder,
  draft: EvalDraft,
  section: SetupSectionId,
  phase: SectionRecord['phase']
): Promise<{ record: SectionRecord; draft: EvalDraft }> {
  const context = contextFor(draft)
  const mark = recorder.count()
  const started = Date.now()
  let result: SetupSectionResult | null = null
  let error: string | null = null
  try {
    result = await runSection(ctx, {
      section,
      context,
      mode: 'redo',
      instruction: null,
      current: [],
      prompt: null
    })
  } catch (cause) {
    error = errorText(cause)
  }
  const calls = recorder.since(mark, sectionAssistId(section))
  const last = calls.at(-1)
  const found = result !== null && (result.text !== null || result.rows.length > 0)
  const record: SectionRecord = {
    section,
    phase,
    status: error !== null ? 'fail' : found ? 'ok' : 'empty',
    durationMs: Date.now() - started,
    error,
    warnings: result?.warnings ?? [],
    context,
    prompt: last?.prompt ?? null,
    reply: last?.reply ?? null,
    rows: result?.rows ?? [],
    text: result?.text ?? null,
    calls
  }
  return {
    record,
    draft: result === null || phase === 'card' ? draft : applySection(draft, section, result)
  }
}

/** What the read found, without the fields the record keeps elsewhere. */
function readResult(fill: FillFromWebsiteResult): NonNullable<ReadRecord['result']> {
  return {
    summary: fill.summary,
    brands: fill.brands,
    products: fill.products,
    competitors: fill.competitors,
    switchingFrom: fill.switchingFrom,
    integrations: fill.integrations,
    suggestedMarket: fill.suggestedMarket
  }
}

/** The page text block of the site-read prompt (before the reply rules main adds). */
export function pageTextOf(prompt: string): string | null {
  const start = prompt.indexOf(PAGES_MARKER)
  if (start < 0) return null
  const body = prompt.slice(start + PAGES_MARKER.length)
  const cuts = [ASSIST_OUTPUT_RULES, SITE_READ_RULES]
    .map((rules) => body.indexOf(`\n\n${rules}`))
    .filter((at) => at >= 0)
  return cuts.length === 0 ? body : body.slice(0, Math.min(...cuts))
}

function skipped(section: SetupSectionId, phase: SectionRecord['phase']): SectionRecord {
  return {
    section,
    phase,
    status: 'skipped',
    durationMs: 0,
    error: null,
    warnings: [],
    context: null,
    prompt: null,
    reply: null,
    rows: [],
    text: null,
    calls: []
  }
}

function phaseOf(section: SetupSectionId): SectionRecord['phase'] {
  return (AUTO_SECTIONS as readonly string[]).includes(section) ? 'auto' : 'card'
}

/** The plain words of a Claude Code limit in force, or null. */
function limitReason(): string | null {
  const pause = claudeCodePause(null, Date.now())
  return pause === null ? null : limitWords(pause.limit, new Date()).message
}

function noPaidSearch(inner: HttpTransport): HttpTransport {
  return {
    request(request) {
      let host = ''
      try {
        host = new URL(request.url).hostname
      } catch {
        // A bad URL fails in the transport.
      }
      if (PAID_HOSTS.test(host)) throw new Error(`The bench refused a paid search call to ${host}.`)
      return inner.request(request)
    }
  }
}

function errorText(cause: unknown): string {
  return redactString(cause instanceof Error ? cause.message : String(cause))
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}
