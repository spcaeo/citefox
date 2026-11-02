import type { SetupContext, SetupRow, SetupSectionPrompt } from '@shared/ipc'
import { pathKey } from '../../engine/site-grounding'
import type { SiteFact, SiteOutline } from '../../engine/site-outline'
import { scrubPrivate } from '../../helpfill/prompt'
import { projectRulesLines } from '../../prompts/project-rules'
import { TOPIC_REPLY_LEAD } from './questions'
import { clip, contextLines } from './rows'
import { sectionAssistId } from './registry'
import type { SectionDef, SiteBlock, TextSectionDef } from './types'

/**
 * The prompt for one section (Docs/ONBOARDING.md "Prompts"). Two parts:
 *
 * 1. The task, which the user may read and edit: the role line, the context lines
 *    that have a value, the section's instructions, the rows it holds now ("Already
 *    listed, don't repeat" for ✦ Find more, "Keep these" for ✦ Redo) and the user's
 *    words on their own line.
 * 2. The reply rules, which main always adds ("Reply with CSV only, this header: …").
 *
 * An edited prompt replaces only the task: any reply rules left in it are cut and
 * main's own are added again. Everything is scrubbed of keys, emails and file paths.
 */

/** Rows listed in the prompt; the rest are counted. */
export const PROMPT_CURRENT_MAX = 60

/** The first line of the reply rules (an edited prompt is cut there). */
export const LIST_REPLY_LEAD = 'Reply with CSV only, this header:'
/** The last reply rule: an empty answer is the header alone, never prose. */
export const LIST_REPLY_EMPTY = 'If there is nothing new to add, reply with the header line only.'
export const TEXT_REPLY_LEAD = 'Reply with the text only: no heading, no notes, no quote marks.'

export interface SectionPromptInput {
  context: SetupContext
  mode: 'more' | 'redo'
  instruction: string | null
  current: readonly SetupRow[]
  /** The site's pages, menu and read finds, for a section that lists them (`def.site`). */
  site?: SiteOutline | null
  /** The owner's project rules (saved ones and the draft's), on their own block. */
  rules?: readonly string[]
}

/** The task part (what "✎ Edit the prompt" shows above the reply rules). */
export function sectionTask(
  def: SectionDef,
  input: SectionPromptInput,
  secrets: readonly string[] = []
): string {
  const lines: string[] = [def.role(input.context), ...contextLines(input.context, def.context)]
  if (def.site !== undefined && input.site) lines.push(...siteLines(input.site, def.site))
  const rules = projectRulesLines(input.rules ?? [])
  if (rules.length > 0) lines.push('', ...rules)
  lines.push('', ...def.task(input.context, def.kind === 'list' ? def.count : 1))
  lines.push('', ...currentLines(def, input))
  const instruction = (input.instruction ?? '').replace(/\s+/gu, ' ').trim()
  if (instruction.length > 0) lines.push('', `The user asks for this: ${instruction}`)
  return scrubPrivate(tidyBlankLines(lines).join('\n'), secrets)
}

/** Most site paths listed in a digest. */
export const DIGEST_PATHS_MAX = 50
const FACTS_MAX = 12

/**
 * The compact site digest (prompt bench report): the site's real paths with their page
 * titles or link words, then what step 3's read found with the words that show it.
 * Only the blocks the section asks for, each left out when empty.
 */
export function siteLines(site: SiteOutline, blocks: readonly SiteBlock[]): string[] {
  const lines: string[] = []
  const facts = site.facts
  for (const block of blocks) {
    switch (block) {
      case 'paths':
        lines.push(...pathLines(site))
        break
      case 'brands':
        if (facts && facts.brands.length > 0) {
          lines.push(`Names the site uses for itself (from the read): ${facts.brands.join('; ')}`)
        }
        break
      case 'quotes':
        lines.push(...factLines('What the pages say it sells', facts?.products ?? []))
        break
      case 'audiences':
        lines.push(...factLines('Who the pages say it is for', facts?.audiences ?? []))
        break
      case 'compared':
        if (facts && facts.comparedWith.length > 0) {
          lines.push(
            `Live products its pages compare it with or help buyers switch from: ${facts.comparedWith.join('; ')}`
          )
        }
        break
      case 'switching':
        lines.push(
          ...factLines(
            'Retired products the pages say buyers switch from',
            facts?.switchingFrom ?? []
          )
        )
        break
      case 'integrations':
        lines.push(...factLines('Tools the pages name', facts?.integrations ?? []))
        break
    }
  }
  return lines.length === 0 ? [] : ['', ...lines]
}

/** "Site paths (the only real pages on it):" and one "- /path: title" line per path. */
function pathLines(site: SiteOutline): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (path: string, words: string): void => {
    const key = pathKey(path)
    if (path.length === 0 || seen.has(key) || out.length >= DIGEST_PATHS_MAX) return
    seen.add(key)
    const label = clip(words.replace(/^["'>)\s]+/u, ''), 70)
    out.push(label.length > 0 ? `- ${path}: ${label}` : `- ${path}`)
  }
  for (const page of site.pages) add(page.path, page.title)
  for (const link of site.menu) add(link.path, link.text)
  return out.length === 0
    ? []
    : ['Site paths (page titles or menu words; no other paths exist):', ...out]
}

/** "Head (with the words that show it):" and "- Name (/path): "quote"" lines. */
function factLines(head: string, facts: readonly SiteFact[]): string[] {
  const rows = facts.slice(0, FACTS_MAX).map((fact) => {
    const where = fact.path === null ? '' : ` (${fact.path})`
    const quote = fact.quote === null ? '' : `: "${clip(fact.quote, 140)}"`
    return `- ${fact.name}${where}${quote}`
  })
  return rows.length === 0 ? [] : [`${head}:`, ...rows]
}

function currentLines(def: SectionDef, input: SectionPromptInput): string[] {
  if (def.kind === 'text') {
    const now = (input.current[0]?.name ?? '').replace(/\s+/gu, ' ').trim()
    return now.length === 0 ? [] : [`What it says now: ${clip(now, 1200)}`]
  }
  const rows = input.current.filter((row) => row.name.trim().length > 0)
  if (rows.length === 0) return []
  const listed = rows.slice(0, PROMPT_CURRENT_MAX).map((row) => `- ${clip(def.line(row), 220)}`)
  const more =
    rows.length > listed.length ? [`- … and ${rows.length - listed.length} more like these.`] : []
  const noun = def.noun[rows.length === 1 ? 0 : 1]
  const head =
    input.mode === 'more'
      ? `Already listed, don't repeat: ${rows.length} ${noun}.`
      : `Keep these ${def.noun[1]}, the user chose them; don't repeat them:`
  return [head, ...listed, ...more]
}

/** The reply rules main adds after the task. */
export function replyRules(def: SectionDef): string[] {
  if (def.kind === 'text') return [textLead(def)]
  return [LIST_REPLY_LEAD, def.columns.join(','), LIST_REPLY_EMPTY]
}

/** The reply's columns as the contract names them (a text section: `text`). */
export function replyColumns(def: SectionDef): string[] {
  return def.kind === 'text' ? ['text'] : [...def.columns]
}

function textLead(def: TextSectionDef): string {
  return def.replyLead ?? TEXT_REPLY_LEAD
}

/** The task part of a prompt the user edited: a routing line and any reply rules cut. */
export function editedTask(prompt: string, secrets: readonly string[] = []): string {
  const lines = prompt.replace(/\r\n?/gu, '\n').split('\n')
  const start = /^Assist: setup\.[A-Za-z]+$/u.test(lines[0]?.trim() ?? '') ? 1 : 0
  const cut = lines.findIndex(
    (line, index) =>
      index >= start &&
      (line.trim().startsWith(LIST_REPLY_LEAD) ||
        line.trim().startsWith('Reply with the text only') ||
        line.trim().startsWith(TOPIC_REPLY_LEAD))
  )
  const kept = lines.slice(start, cut < 0 ? undefined : cut)
  return scrubPrivate(tidyBlankLines(kept).join('\n'), secrets)
}

/** The whole prompt one run sends without the routing line (shown and copied). */
export function fullPrompt(def: SectionDef, task: string): string {
  return `${task}\n\n${replyRules(def).join('\n')}`
}

/** What an in-app run sends: the routing line, the task, the reply rules. */
export function runPrompt(def: SectionDef, task: string): string {
  return `Assist: ${sectionAssistId(def.id)}\n${fullPrompt(def, task)}`
}

export function promptResult(def: SectionDef, task: string): SetupSectionPrompt {
  return {
    section: def.id,
    prompt: fullPrompt(def, task),
    columns: replyColumns(def),
    webSearch: def.webSearch
  }
}

/** No blank line first or last, and never two in a row. */
function tidyBlankLines(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const blank = line.trim().length === 0
    if (blank && (out.length === 0 || out.at(-1)?.trim().length === 0)) continue
    out.push(blank ? '' : line.replace(/[ \t]+$/u, ''))
  }
  while (out.length > 0 && out.at(-1)?.trim().length === 0) out.pop()
  return out
}
