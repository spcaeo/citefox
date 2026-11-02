import type { CompanySuggestion, FillFromWebsiteResult } from '@shared/ipc'
import { hasMetaNote } from '../engine/competitor-guard'
import { toContext } from '../handlers/context'
import type { EngineContext } from '../handlers/context'
import { projectsHandlers } from '../handlers/projects'
import { createLogger } from '../logging'
import type { BinaryProbe } from '../providers'
import { createClaudeCodeProvider } from '../providers/claude/claude-code'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage } from '../storage'
import type { AppStorage } from '../storage'
import { claudeChildEnv } from './env-file'
import type { EnvFile } from './env-file'
import { printFillProducts } from './fill-products'
import { blankReport, createDataDir, failText, SmokeError, watchSerp } from './live'
import type { SmokeIo, SmokeReport } from './live'

export interface FillSmokeOptions {
  io: SmokeIo
  domain: string
  loaded: EnvFile
  secrets: readonly string[]
  parentEnv: NodeJS.ProcessEnv
  command: CommandTransport
  probe: BinaryProbe
  claudeBinary: string
  home: string
  platform: NodeJS.Platform
  clock: () => Date
  http: HttpTransport
  dataDir?: string
}

/**
 * Fill mode (`npm run smoke:live -- --env <path> --fill <domain>`, batch 2 row 3): the
 * real `projects:fillFromWebsite` handler on a temp data dir, with real page reads, the
 * real Claude Code CLI (web search on for the competitor step only, batch 2 row 5) and real
 * DNS. No SerpApi search (any is refused). Prints the summary, each product with its direct
 * and partial competitors, then switch-from and integrations, with each domain, its source
 * (site / search / lookup / unknown), price and sources, and fails when a reason carries a
 * note about the pages read.
 */
export async function runFillSmoke(options: FillSmokeOptions): Promise<SmokeReport> {
  const { io, secrets } = options
  const report = blankReport(false)
  const http = watchSerp(options.http, 0)
  const dataDir = createDataDir(options.dataDir)
  report.dataDir = dataDir
  // Only the fill's own notes (left out, failed search) are shown; already redacted.
  const logger = createLogger({
    write: (_level, line) => {
      if (/left out|search failed|switch-from read failed|site read/u.test(line))
        io.stdout(`log ${line}`)
    },
    secrets: () => secrets
  })
  let storage: AppStorage | null = null
  let ctx: EngineContext | null = null
  const started = Date.now()
  try {
    storage = openAppStorage(dataDir)
    const provider = createClaudeCodeProvider({
      command: options.command,
      probe: options.probe,
      logger,
      savedBinaryPath: options.claudeBinary,
      baseEnv: claudeChildEnv(options.parentEnv, Object.keys(options.loaded.values)),
      secrets: () => secrets,
      home: options.home,
      platform: options.platform,
      pathEnv: options.parentEnv.PATH
    })
    ctx = toContext({
      appInfo: () => ({ name: 'CiteFox', version: 'smoke' }),
      storage,
      secrets: new MemorySecretStore(new SecretRegistry()),
      logger,
      http: http.transport,
      claudeCommand: options.command,
      claudeProbe: options.probe,
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => secrets,
      now: options.clock,
      claude: provider
    })
    const result = await projectsHandlers(ctx)['projects:fillFromWebsite']({
      projectId: null,
      domain: options.domain
    })
    const lines = fillLines(result)
    for (const line of lines) io.stdout(line)
    const meta = [...result.competitors, ...result.switchingFrom, ...result.integrations].filter(
      (item) => hasMetaNote(item.reason)
    )
    // Prompt audit PC: save the read to a temp project and print competitors by product.
    if (result.nextStep === null) await printFillProducts(ctx, io, result)
    if (http.searches() !== 0) throw new SmokeError('Fill sent a SerpApi search.')
    if (meta.length > 0) {
      throw new SmokeError(
        `A reason still carries a note about the pages read: ${meta.map((item) => item.name).join(', ')}`
      )
    }
    report.searches = 0
    report.ok = result.nextStep === null
    io.stdout(`fill ${report.ok ? 'ok' : 'fail'} ${Date.now() - started}ms searches=0`)
    if (!report.ok) io.stderr(`${result.message} ${result.nextStep ?? ''}`.trim())
    io.stdout(`data ${dataDir}`)
    return report
  } catch (error) {
    if (error instanceof SmokeError && error.reported) throw error
    const message = `Fill smoke failed: ${failText(error, secrets)}`
    io.stderr(message)
    throw new SmokeError(message, true)
  } finally {
    try {
      ctx?.email.close()
    } catch {
      // Closing the temp email store should not hide the result.
    }
    try {
      storage?.close()
    } catch {
      // Closing a temp database should not hide the smoke result.
    }
  }
}

/**
 * The summary, then each product with its direct and partial competitors (domain, source,
 * starting price, source count), then what buyers switch from and integrations.
 */
export function fillLines(result: FillFromWebsiteResult): string[] {
  const lines = [
    `site ${result.domain} pages=${result.pagesRead.filter((page) => page.ok).length}/${result.pagesRead.length} (${result.pagesRead.map((page) => `${page.role}:${page.ok ? 'ok' : 'no'}`).join(' ')})`,
    `summary ${result.summary ?? 'none'}`,
    `brands ${result.brands.map((brand) => brand.name).join(', ') || 'none'}`,
    `market ${result.suggestedMarket ? `${result.suggestedMarket.country}/${result.suggestedMarket.language}` : 'none'}`
  ]
  const products = result.products ?? []
  lines.push(`Products (${products.length})`)
  for (const product of products) {
    lines.push(`  # ${product.name} · job: ${product.job} · buyer: ${product.buyer}`)
    if (product.searchNote) lines.push(`    note: ${product.searchNote}`)
    for (const tier of ['direct', 'partial'] as const) {
      const rows = result.competitors.filter(
        (item) => item.product === product.id && item.tier === tier
      )
      lines.push(`    ${tier} (${rows.length})`)
      for (const item of rows) lines.push(...companyLines(item, '      '))
    }
  }
  const loose = result.competitors.filter((item) => !products.some((p) => p.id === item.product))
  if (loose.length > 0) {
    lines.push(`Competitors without a product (${loose.length})`)
    for (const item of loose) lines.push(...companyLines(item, '  '))
  }
  const groups: [string, readonly CompanySuggestion[]][] = [
    ['What buyers switch from', result.switchingFrom],
    ['Integrations & partners', result.integrations]
  ]
  for (const [title, items] of groups) {
    lines.push(`${title} (${items.length})`)
    for (const item of items) lines.push(...companyLines(item, '  '))
  }
  return lines
}

function companyLines(item: CompanySuggestion, indent: string): string[] {
  const source = item.domain === null ? 'unknown' : (item.domainSource ?? 'site')
  const sources = item.sources ?? []
  const biased = sources.filter((entry) => entry.biased).length
  const extra = [
    item.startingPrice ? `from ${item.startingPrice}` : null,
    item.sources ? `sources=${sources.length}${biased > 0 ? ` (${biased} biased)` : ''}` : null
  ].filter((part): part is string => part !== null)
  const lines = [
    `${indent}- ${item.name} · ${item.domain ?? 'Domain unknown'} · ${source}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}`,
    `${indent}  reason: ${item.reason}`
  ]
  if (item.evidence)
    lines.push(`${indent}  evidence: ${item.evidence.path} "${item.evidence.quote}"`)
  return lines
}
