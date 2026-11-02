// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import type { EvalArgs } from './args'
import type { SiteRecord } from './run'

/**
 * `summary.md`: one table, site by step (the site read, then each section) with its
 * state and time, then what each site's setup says it does. Pure.
 */
export function summaryMarkdown(
  args: EvalArgs,
  sites: readonly SiteRecord[],
  calls: number,
  durationMs: number,
  stopped: string | null
): string {
  const lines = [
    `# Prompt bench: ${args.label}`,
    '',
    `Market ${args.country}/${args.language} · ${sites.length} of ${args.sites.length} sites · ${calls} Claude calls · ${minutes(durationMs)}`,
    ''
  ]
  if (stopped !== null) lines.push(`**Stopped early:** ${stopped}`, '')
  const header = ['site', 'read', ...args.sections]
  lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`)
  for (const site of sites) {
    const cells = [
      site.domain,
      cell(site.read.status, site.read.durationMs),
      ...args.sections.map((id) => {
        const found = site.sections.find((section) => section.section === id)
        return found === undefined ? '—' : cell(found.status, found.durationMs)
      })
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('', '## What each site does (step 3 read, then the ✦ Redo card)', '')
  for (const site of sites) {
    lines.push(`### ${site.domain}`, '')
    lines.push(`- Read: ${oneLine(site.read.result?.summary ?? site.read.message ?? '(none)')}`)
    const card = site.sections.find((section) => section.section === 'summary')
    if (card !== undefined && card.status !== 'skipped') {
      lines.push(`- Card: ${oneLine(card.text ?? card.error ?? '(none)')}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function cell(status: string, ms: number): string {
  return status === 'skipped' ? 'skipped' : `${status} ${Math.round(ms / 1000)}s`
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').replace(/\|/gu, '/').trim()
}

function minutes(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)} min ${total % 60} s`
}
