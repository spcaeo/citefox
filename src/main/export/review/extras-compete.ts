import type { MetricsResult } from '@shared/metrics'
import type { SiteKind, SortableSiteKind } from '@shared/report/site-kinds'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import type { ProjectRecord } from '../../storage/records'
import { readSiteKinds } from '../../storage/site-kinds'
import { questionTargetPages } from '../../topics/question-targets'
import { listAllTopicPrompts } from '../../topics/records'
import { domainKind } from '../model/site-kinds'

/**
 * The report extras the shared parts of every ready report need (Docs/REPORT-SPEC.md
 * "Competitors", "Questions"): each question's own pages (Primary + Also OK) and the
 * kind of each cited site. Read-only; never asks CiteFox AI.
 */

/**
 * Own pages by metrics `questionId`. A topic question reads its Primary and Also OK
 * pages (`questionTargetPages`, the classify rule); a tracked page's question is
 * checked for that page.
 */
export function loadQuestionTargets(
  db: SqliteDatabase,
  project: ProjectRecord,
  metrics: MetricsResult
): Record<string, readonly string[]> {
  const pages = new Map(listPages(db, project.id).map((page) => [page.id, page]))
  const topicPages = new Map<string, Map<string, readonly string[]>>()
  const out: Record<string, readonly string[]> = {}
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all' || out[row.questionId] !== undefined) continue
    if (row.sourceKind === 'page') {
      const url = pages.get(row.sourceId)?.url ?? null
      out[row.questionId] = url === null ? [] : [url]
      continue
    }
    let byPrompt = topicPages.get(row.sourceId)
    if (byPrompt === undefined) {
      try {
        byPrompt = questionTargetPages(db, row.sourceId)
      } catch {
        byPrompt = new Map()
      }
      topicPages.set(row.sourceId, byPrompt)
    }
    // Row ids are `engine:runId:promptId`.
    const promptId = row.id.split(':').slice(2).join(':')
    const list = byPrompt.get(promptId)
    if (list !== undefined) out[row.questionId] = list
  }
  return out
}

/** The kind of every cited site but your own, as the Competitors screen sorts them. */
export function loadSiteKinds(
  db: SqliteDatabase,
  metrics: MetricsResult
): Record<string, SiteKind> {
  const domains = metrics.domains.filter((row) => !row.own).map((row) => row.domain)
  if (domains.length === 0) return {}
  const competitors = readProjectProfile(db)?.competitors ?? []
  const facts = { competitors, siteKinds: storedKinds(db, domains) }
  return Object.fromEntries(domains.map((domain) => [domain, domainKind(domain, false, facts)]))
}

function storedKinds(
  db: SqliteDatabase,
  domains: readonly string[]
): Record<string, SortableSiteKind> {
  try {
    return Object.fromEntries(readSiteKinds(db, domains))
  } catch {
    // A project file written before the site_kinds table: built-in list and competitors only.
    return {}
  }
}

/**
 * CiteFox AI's page pick for each topic question (sure or not), by metrics `questionId`:
 * the Content plan's page to write or fix when the question has no Primary page.
 */
export function loadAiPages(db: SqliteDatabase, metrics: MetricsResult): Record<string, string> {
  const byTopic = new Map<string, Map<string, string>>()
  const out: Record<string, string> = {}
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all' || row.sourceKind !== 'topic' || out[row.questionId] !== undefined) {
      continue
    }
    let picks = byTopic.get(row.sourceId)
    if (picks === undefined) {
      picks = new Map()
      try {
        for (const record of listAllTopicPrompts(db, row.sourceId)) {
          if (record.matchSetBy === 'claude' && record.targetUrl) {
            picks.set(record.promptId, record.targetUrl)
          }
        }
      } catch {
        // A project file without topic prompts: no picks.
      }
      byTopic.set(row.sourceId, picks)
    }
    // Row ids are `engine:runId:promptId`.
    const pick = picks.get(row.id.split(':').slice(2).join(':'))
    if (pick !== undefined) out[row.questionId] = pick
  }
  return out
}
