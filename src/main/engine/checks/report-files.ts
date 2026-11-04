import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AioGapFact, PromptCheckStatus, RunSummaryText } from '@shared/domain'
import { redactString } from '../../logging/redact'
import { atomicWriteFile, type AtomicFileIo } from '../../storage/atomic-file'
import { assertId } from '../../storage/values'

const HASH_TOKEN = 'CITEFOX_TEMPLATE_HASH'

const STATUS_LABEL: Record<PromptCheckStatus, string> = {
  page_cited: 'page cited',
  other_own_page: 'other own page cited',
  brand_mentioned: 'brand mentioned without a link',
  not_cited: 'not cited',
  no_aio: 'no AIO',
  error: 'error'
}

export interface ReportReferenceLine {
  position: number
  title: string
  classification: 'this page' | 'own' | 'competitor' | 'other'
  url: string
}

export interface AioGapPromptSection {
  id: string
  position: number
  label: string
  text: string
  status: PromptCheckStatus
  overview: string | null
  /** False when Claude did not compare this prompt (page cited, no overview, or error). */
  compared: boolean
  skipReason: string | null
  facts: readonly AioGapFact[]
  references: readonly ReportReferenceLine[]
}

export interface AioGapDocument {
  templateHash: string
  runId: string
  pageUrl: string
  marketLine: string
  prompts: readonly AioGapPromptSection[]
}

export interface RunSummaryDocument {
  templateHash: string
  headline: string
  body: string
  aiosShown: number
  pageCited: number
  otherOwnPage: number
  namedWithoutLink: number
  invisible: number
  citation: string
  content: string
  notes: string
  closing: string
}

/** `<userData>/check-reports`. The SRS names the files, not this directory. */
export function checkReportsRoot(userData: string): string {
  return join(resolve(userData), 'check-reports')
}

export function runReportDir(root: string, projectId: string, runId: string): string {
  return join(resolve(root), assertId(projectId), assertId(runId))
}

export function aioGapPath(root: string, projectId: string, runId: string): string {
  return join(runReportDir(root, projectId, runId), 'aio_gap.md')
}

export function runSummaryPath(root: string, projectId: string, runId: string): string {
  return join(runReportDir(root, projectId, runId), 'run_summary.md')
}

export function statusLabel(status: PromptCheckStatus): string {
  return STATUS_LABEL[status]
}

/**
 * FR-6.6 and FR-13.4. One file per finished run. Compared prompts list facts.
 * Prompts Claude did not compare are listed and have no facts.
 */
export function renderAioGapMarkdown(document: AioGapDocument): string {
  const lines = [
    '# What the overview says that the page does not',
    '',
    'Template: aio_gap.md',
    `Template hash: ${document.templateHash}`,
    `Run: ${document.runId}`,
    `Page: ${document.pageUrl}`,
    `Market: ${document.marketLine}`,
    ''
  ]
  for (const prompt of document.prompts) {
    if (!prompt.compared) continue
    lines.push(
      `## Prompt ${prompt.id}`,
      '',
      `Position: ${prompt.position}`,
      `Label: ${oneLine(prompt.label)}`,
      `Status: ${statusLabel(prompt.status)}`,
      `Prompt: ${oneLine(prompt.text)}`,
      `Overview: ${oneLine(prompt.overview ?? '')}`,
      '',
      '### Facts the overview states that the page does not',
      ''
    )
    if (prompt.facts.length === 0) lines.push('None.', '')
    else {
      prompt.facts.forEach((fact, index) => {
        lines.push(`${index + 1}. ${oneLine(fact.fact)}`)
        lines.push(`   Likely source: ${fact.likelySource ?? 'not named'}`)
      })
      lines.push('')
    }
    lines.push('### References', '')
    if (prompt.references.length === 0) lines.push('None.', '')
    else {
      for (const reference of prompt.references) {
        lines.push(
          `${reference.position}. ${oneLine(reference.title)} — ${reference.classification} — ${reference.url}`
        )
      }
      lines.push('')
    }
  }
  lines.push('## Prompts not compared', '')
  const skipped = document.prompts.filter((prompt) => !prompt.compared)
  if (skipped.length === 0) lines.push('None.')
  else {
    for (const prompt of skipped) {
      lines.push(
        `- Prompt ${prompt.id} (${statusLabel(prompt.status)}): ${prompt.skipReason ?? 'CiteFox AI did not compare this prompt.'}`
      )
    }
  }
  lines.push('')
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`
}

/** FR-12.3 and section 7.3. Headline counts, then the side-by-side body. */
export function renderRunSummaryMarkdown(document: RunSummaryDocument): string {
  const lines = [
    '# Run summary',
    '',
    'Template: run_summary.md',
    `Template hash: ${document.templateHash}`,
    '',
    '## Headline',
    '',
    document.headline,
    '',
    '## Body',
    '',
    document.body,
    '',
    '## Counts',
    '',
    `- AIOs shown: **${document.aiosShown}**`,
    `- Page cited: **${document.pageCited}**`,
    `- Other own page: **${document.otherOwnPage}**`,
    `- Named without a link: **${document.namedWithoutLink}**`,
    `- Invisible: **${document.invisible}**`,
    '',
    '## Citation change',
    '',
    document.citation,
    '',
    '## Content',
    '',
    document.content,
    '',
    '## Notes',
    '',
    document.notes,
    '',
    document.closing,
    ''
  ]
  return lines.join('\n')
}

export function headlineSentence(counts: {
  aiosShown: number
  pageCited: number
  otherOwnPage: number
  namedWithoutLink: number
  invisible: number
}): string {
  return [
    `**${counts.aiosShown}** AIOs shown`,
    `**${counts.pageCited}** page cited`,
    `**${counts.otherOwnPage}** other own page`,
    `**${counts.namedWithoutLink}** named without a link`,
    `**${counts.invisible}** invisible`
  ]
    .join(', ')
    .concat('.')
}

export const SUMMARY_CLOSING =
  'The citation change and the content change are stated side by side. This summary does not say that a content edit produced a citation change.'

export const NOTES_ABSENT = 'No notes are stored for this page.'

/**
 * NFR-5. Redact the report, then put the template hash back.
 * Hex strings are masked in the body. The hash is a fingerprint of the template, not a key.
 */
export function redactReport(markdown: string, hash: string, secrets: readonly string[]): string {
  const marked = markdown.split(hash).join(HASH_TOKEN)
  const redacted = redactString(marked, { secrets, hexKeys: true })
  return redacted.split(HASH_TOKEN).join(hash)
}

/** Temp file, then rename. A failed rename leaves the previous file in place. */
export function writeReportFile(filePath: string, contents: string, io?: AtomicFileIo): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  const text = contents.endsWith('\n') ? contents : `${contents}\n`
  atomicWriteFile(filePath, text, io)
}

export function readStoredRunSummary(
  reportsRoot: string,
  projectId: string,
  runId: string
): RunSummaryText | null {
  return readStored(runSummaryPath(reportsRoot, projectId, runId), readRunSummaryMarkdown)
}

export function readStoredAioGap(
  reportsRoot: string,
  projectId: string,
  runId: string,
  promptId: string
): readonly AioGapFact[] | null {
  return readStored(aioGapPath(reportsRoot, projectId, runId), (markdown) =>
    readAioGapMarkdown(markdown, promptId)
  )
}

export function readRunSummaryMarkdown(markdown: string): RunSummaryText | null {
  const headline = section(markdown, 'Headline')
  const body = section(markdown, 'Body')
  if (headline === null || body === null || headline.length === 0 || body.length === 0) return null
  return { headline, body }
}

/** Null when this prompt was not compared. An empty list means Claude found no missing facts. */
export function readAioGapMarkdown(
  markdown: string,
  promptId: string
): readonly AioGapFact[] | null {
  const marker = `## Prompt ${promptId}\n`
  const start = markdown.indexOf(marker)
  if (start < 0) return null
  const from = start + marker.length
  const next = markdown.indexOf('\n## ', from)
  const block = next < 0 ? markdown.slice(from) : markdown.slice(from, next)
  if (!block.includes('### Facts the overview states that the page does not')) return null
  const factsAt = block.indexOf('### Facts the overview states that the page does not\n\n')
  if (factsAt < 0) return null
  const after = block.slice(
    factsAt + '### Facts the overview states that the page does not\n\n'.length
  )
  const factsBody = after.split('\n### ')[0] ?? ''
  if (factsBody.trim() === 'None.') return []
  const facts: AioGapFact[] = []
  const pattern = /^(\d+)\. (.+)\n {3}Likely source: (.+)$/gm
  for (const match of factsBody.matchAll(pattern)) {
    const fact = match[2]
    const source = match[3]
    if (fact === undefined || source === undefined) continue
    facts.push({
      fact,
      likelySource: source === 'not named' ? null : source
    })
  }
  return facts
}

function readStored<T>(filePath: string, parse: (markdown: string) => T | null): T | null {
  try {
    return parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function section(markdown: string, title: string): string | null {
  const marker = `## ${title}\n\n`
  const start = markdown.indexOf(marker)
  if (start < 0) return null
  const from = start + marker.length
  const next = markdown.indexOf('\n## ', from)
  const raw = (next < 0 ? markdown.slice(from) : markdown.slice(from, next)).trim()
  return raw.length === 0 ? null : raw
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
