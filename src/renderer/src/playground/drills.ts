import type { PlaygroundAioPromptResult, PlaygroundAioResult } from '@shared/ipc'
import type { DrillItem, DrillScope, ItemDrill } from '../drill'
import { safeExternalUrl } from '../drill'
import type { CoverageRowView, CoverageView } from './output'

/**
 * Playground drill-downs (REPORT-SPEC "Interaction model"). A playground run
 * is not saved, so nothing links into a project: rows expand to the text
 * behind them, and sources open in the browser.
 */

const SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: 'Playground run, not saved',
  brand: '',
  domain: ''
}

export type CoverageLevel = CoverageRowView['coverage']
export const COVERAGE_LEVELS: readonly CoverageLevel[] = ['Strong', 'Partial', 'Weak', 'None']

function coverageItem(row: CoverageRowView): DrillItem {
  return {
    id: `row-${row.n}`,
    primary: `${row.n}. ${row.prompt}`,
    cells: { coverage: row.coverage },
    detail: `**Where covered now:** ${row.where || '—'}\n\n**Main gap:** ${row.gap || '—'}\n\n**Action:** ${row.action || '—'}`,
    group: row.coverage
  }
}

/** The coverage matrix rows at one level, or every row (`level` null). */
export function coverageDrill(view: CoverageView, level: CoverageLevel | null): ItemDrill {
  const rows = level === null ? view.rows : view.rows.filter((row) => row.coverage === level)
  return {
    kind: 'items',
    id: level === null ? 'pg-coverage:all' : `pg-coverage:${level.toLowerCase()}`,
    title: level === null ? 'Coverage matrix' : `${level} coverage`,
    description:
      level === null
        ? 'Every buyer question in this run, with how well the page covers it.'
        : `Buyer questions the page covers at the "${level}" level in this run.`,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [{ id: 'coverage', label: 'Coverage', width: '88px' }],
    items: rows.map(coverageItem),
    ...(level === null
      ? { summary: COVERAGE_LEVELS.map((item) => ({ label: item, group: item })) }
      : {}),
    note: 'Expand a question to read where the page covers it, the main gap and the action.',
    scope: SCOPE
  }
}

export type AioPart = 'all' | 'cited' | 'not_cited'

function aioGroup(prompt: PlaygroundAioPromptResult): string {
  if (!prompt.ok) return 'failed'
  return prompt.cited ? 'cited' : 'not_cited'
}

function sourcesMarkdown(prompt: PlaygroundAioPromptResult, pageUrl: string): string {
  if (prompt.citedSources.length === 0) return 'No sources listed.'
  return prompt.citedSources
    .map((source) => {
      const own = sameUrl(source.url, pageUrl) ? ' (this page)' : ''
      const url = safeExternalUrl(source.url)
      return url
        ? `${source.position}. [${source.domain}](${url})${own}`
        : `${source.position}. ${source.domain}${own}`
    })
    .join('\n')
}

export function sameUrl(left: string, right: string): boolean {
  return left.replace(/\/+$/, '') === right.replace(/\/+$/, '')
}

/** The AI Overviews checked in this run: every prompt, or the cited / not-cited ones. */
export function aioDrill(result: PlaygroundAioResult, pageUrl: string, part: AioPart): ItemDrill {
  const prompts = result.prompts.filter((prompt) => part === 'all' || aioGroup(prompt) === part)
  const items: DrillItem[] = prompts.map((prompt, index) => ({
    id: `aio-${index}-${prompt.prompt}`,
    primary: prompt.prompt,
    secondary: !prompt.ok
      ? (prompt.message ?? 'The check did not finish.')
      : prompt.position === null
        ? `Not cited · ${prompt.citedSources.length} sources`
        : `Page cited at position ${prompt.position} of ${prompt.citedSources.length}`,
    cells: {
      result: !prompt.ok ? 'Failed' : prompt.cited ? 'Cited' : 'Not cited',
      position: prompt.position
    },
    detail: `**AI Overview:** ${prompt.summary ?? 'No overview text.'}\n\n**Sources Google listed:**\n\n${sourcesMarkdown(prompt, pageUrl)}`,
    group: aioGroup(prompt)
  }))
  return {
    kind: 'items',
    id: `pg-aio:${part}`,
    title:
      part === 'cited'
        ? 'Questions that cite the page'
        : part === 'not_cited'
          ? "Questions that don't cite the page"
          : 'AI Overviews checked',
    description: `Live AI Overview checks for ${pageUrl} in this playground run. Nothing is saved until you save the run to a project.`,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [
      { id: 'result', label: 'Result', width: '88px' },
      { id: 'position', label: 'Position', align: 'end', width: '72px' }
    ],
    items,
    ...(part === 'all'
      ? {
          summary: [
            { label: 'Cited', group: 'cited' },
            { label: 'Not cited', group: 'not_cited' },
            { label: 'Failed', group: 'failed' }
          ]
        }
      : {}),
    note: 'Expand a question to read the overview and open its sources. Position is where the page sits among the sources (1 = first).',
    scope: SCOPE
  }
}
