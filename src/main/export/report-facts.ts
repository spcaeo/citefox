import { overviewHash, type StoredAnswerShape } from '../analytics/answer-shape/vocabulary'
import { AIO_GAP_TEMPLATE, RUN_SUMMARY_TEMPLATE } from '../engine/checks/report-templates'
import { bareDomain } from '../engine/checks/url'
import { getAnswerShapes } from '../storage/answer-shapes'
import { readSiteKinds } from '../storage/site-kinds'
import type { SqliteDatabase } from '../storage/database'
import { listMarkets, type ProjectProfile } from '../storage/project-profile'
import type { TemplateUse } from './model/types'
import type { ExportPage, ExportReportFacts } from './types'

/**
 * Report facts for the export source: project profile, markets, the template versions
 * behind the data (cover), and the stored answer-shape classifications for every
 * overview in the dataset, and the stored kinds of the cited domains. Reads only; never
 * calls Claude.
 */
export function readReportFacts(
  db: SqliteDatabase,
  input: {
    domain: string
    profile: ProjectProfile | null
    pages: readonly ExportPage[]
    promptSetIds: readonly string[]
  }
): ExportReportFacts {
  const texts = input.pages.flatMap((page) =>
    page.markets.flatMap((market) =>
      market.checks.flatMap((check) =>
        check.details.flatMap((detail) =>
          detail.aioText === null || detail.aioText.trim().length === 0 ? [] : [detail.aioText]
        )
      )
    )
  )
  const answerShapes = readShapes(db, texts)
  const domains = input.pages.flatMap((page) =>
    page.markets.flatMap((market) =>
      market.checks.flatMap((check) =>
        check.prompts.flatMap((row) => row.references.map((reference) => reference.domain))
      )
    )
  )
  return {
    domain: bareDomain(input.domain),
    brandNames: input.profile?.brandNames ?? [],
    competitors: input.profile?.competitors ?? [],
    includeSubdomains: input.profile?.includeSubdomains ?? false,
    brandColor: null,
    markets: listMarkets(db).map((market) => ({
      id: market.id,
      country: market.country,
      language: market.language
    })),
    templates: templateUses(db, input.pages, input.promptSetIds, answerShapes),
    answerShapes,
    siteKinds: Object.fromEntries(readSiteKinds(db, domains))
  }
}

function readShapes(db: SqliteDatabase, texts: readonly string[]): StoredAnswerShape[] {
  if (texts.length === 0) return []
  try {
    return [
      ...getAnswerShapes(
        db,
        texts.map((text) => overviewHash(text))
      ).values()
    ]
  } catch {
    // A project file written before the answer_shapes table: the section shows its empty state.
    return []
  }
}

function templateUses(
  db: SqliteDatabase,
  pages: readonly ExportPage[],
  promptSetIds: readonly string[],
  shapes: readonly StoredAnswerShape[]
): TemplateUse[] {
  const uses: TemplateUse[] = []
  const add = (use: TemplateUse): void => {
    if (use.hash.length === 0) return
    if (uses.some((item) => item.kind === use.kind && item.hash === use.hash)) return
    uses.push(use)
  }
  for (const id of new Set(promptSetIds)) {
    const row = db
      .prepare<
        unknown[],
        {
          set_name: string | null
          set_hash: string | null
          profile_name: string | null
          profile_hash: string | null
        }
      >(
        `SELECT prompt_sets.template_name AS set_name, prompt_sets.template_hash AS set_hash,
                buyer_profiles.template_name AS profile_name, buyer_profiles.template_hash AS profile_hash
         FROM prompt_sets LEFT JOIN buyer_profiles ON buyer_profiles.id = prompt_sets.icp_id
         WHERE prompt_sets.id = ?`
      )
      .get(id)
    if (row === undefined) continue
    if (row.profile_hash !== null) {
      add({
        kind: 'buyer_profile',
        name: row.profile_name ?? 'CiteFox default',
        hash: row.profile_hash
      })
    }
    if (row.set_hash !== null) {
      add({ kind: 'buyer_prompts', name: row.set_name ?? 'CiteFox default', hash: row.set_hash })
    }
  }
  for (const page of pages) {
    if (page.gaps !== null) {
      add({ kind: 'coverage', name: page.gaps.templateName, hash: page.gaps.templateHash })
    }
  }
  if (pages.some((page) => page.markets.some((market) => market.checks.length > 0))) {
    add({ kind: 'aio_gap', name: AIO_GAP_TEMPLATE.name, hash: AIO_GAP_TEMPLATE.hash })
    add({ kind: 'run_summary', name: RUN_SUMMARY_TEMPLATE.name, hash: RUN_SUMMARY_TEMPLATE.hash })
  }
  for (const shape of shapes) {
    add({ kind: 'answer_shape', name: 'answer_shape', hash: shape.templateHash })
  }
  return uses
}
