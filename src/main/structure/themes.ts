import type { ClusterTheme, ClusterThemePrompt } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'

/** One active, enabled prompt of a page, with its variant texts. */
interface PagePrompt {
  pageId: string
  promptId: string
  position: number
  label: string
  texts: string[]
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The active prompts of these pages (one row per prompt, variants folded in),
 * in page order then prompt position.
 */
function pagePrompts(db: SqliteDatabase, pageIds: readonly string[]): PagePrompt[] {
  if (pageIds.length === 0) return []
  const rows = db
    .prepare<
      unknown[],
      { page_id: string; prompt_id: string; position: number; label: string; text: string | null }
    >(
      `SELECT ps.page_id, p.id AS prompt_id, p.position, p.label, v.text FROM prompt_sets ps
       JOIN prompts p ON p.prompt_set_id = ps.id
       LEFT JOIN prompt_variants v ON v.prompt_id = p.id
       WHERE ps.is_active = 1 AND p.enabled = 1
         AND ps.page_id IN (SELECT value FROM json_each(?))
       ORDER BY ps.page_id, p.position`
    )
    .all(JSON.stringify(pageIds))
  const byId = new Map<string, PagePrompt>()
  for (const row of rows) {
    const found = byId.get(row.prompt_id)
    if (found) {
      if (row.text !== null) found.texts.push(row.text)
      continue
    }
    byId.set(row.prompt_id, {
      pageId: row.page_id,
      promptId: row.prompt_id,
      position: row.position,
      label: row.label,
      texts: row.text === null ? [] : [row.text]
    })
  }
  return [...byId.values()]
}

/**
 * True when a prompt stands behind a theme. Themes are the most common prompt
 * labels (cut to 80 characters), or, with no prompts, frequent words; Claude's
 * themes are short buyer questions. So a prompt matches when its label or a
 * variant equals the theme, or contains every word of it.
 */
function matches(prompt: PagePrompt, theme: string): boolean {
  const target = normalize(theme)
  if (target.length === 0) return false
  const words = target.split(/[^a-z0-9]+/).filter((word) => word.length > 2)
  for (const raw of [prompt.label, ...prompt.texts]) {
    const text = normalize(raw)
    if (text === target || text.slice(0, 80) === target) return true
    if (words.length > 0 && words.every((word) => text.includes(word))) return true
  }
  return false
}

/**
 * The prompts behind each of a cluster's themes (REPORT-SPEC "every number
 * drills"): a theme tag opens exactly these prompts.
 */
export function clusterThemes(
  db: SqliteDatabase,
  themes: readonly string[],
  pages: readonly { id: string; title: string | null; url: string }[]
): ClusterTheme[] {
  if (themes.length === 0) return []
  const prompts = pagePrompts(
    db,
    pages.map((page) => page.id)
  )
  const labels = new Map(pages.map((page) => [page.id, page.title?.trim() || pathOf(page.url)]))
  return themes.map((theme) => ({
    theme,
    prompts: prompts
      .filter((prompt) => matches(prompt, theme))
      .map((prompt): ClusterThemePrompt => ({
        pageId: prompt.pageId,
        promptId: prompt.promptId,
        position: prompt.position,
        label: prompt.label,
        pageLabel: labels.get(prompt.pageId) ?? prompt.pageId
      }))
  }))
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
