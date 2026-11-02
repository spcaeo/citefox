import { isAnswerShapeCode, type AnswerShapeCode } from '@shared/answer-shape'
import { cleanHost } from '@shared/competitor-hosts'
import {
  isCitationSourceType,
  isEngineAnswerStatus,
  isPromptCheckStatus,
  type CitationSourceType
} from '@shared/domain'
import type { MetricsResult } from '@shared/metrics'
import type {
  AnswerExtras,
  CitedSource,
  SourceWho,
  ThreadFacts,
  VideoFacts
} from '@shared/report/review'
import { sourceTypeOf } from '@shared/source-type'
import { redditThreadOf } from '@shared/source-type'
import { overviewHash } from '../../analytics/answer-shape/vocabulary'
import { loadExportSourceExtras } from '../../communities/export-extras'
import { rollupSamples } from '../../engine/checks/score'
import { rollUpStatus } from '../../engine/engines/views'
import { getAnswerShapes } from '../../storage/answer-shapes'
import type { SqliteDatabase } from '../../storage/database'

/**
 * The Sources and Answer shape tabs' extras (src/shared/report/review/sources-types.ts)
 * from the project file, for every engine row the metrics name: the pages each answer
 * cites (Google's winning sample, the answer engines' best-status samples, as the
 * metrics read them), each answer's stored block classification, and the Communities
 * caches ("Get views", "Check threads"). Read-only; nothing is searched or classified.
 */
export function loadAnswerExtras(db: SqliteDatabase, metrics: MetricsResult): AnswerExtras {
  const googleSamples = db.prepare<
    [string, string],
    { id: string; sample_no: number; status: string; text: string | null }
  >(
    `SELECT id, sample_no, status, aio_text AS text FROM serp_results
     WHERE run_id = ? AND prompt_id = ? ORDER BY sample_no`
  )
  const googleRefs = db.prepare<[string], SourceSql & { source_type: string | null }>(
    `SELECT url, normalized_url, domain, title, classification, source_type
     FROM aio_references WHERE serp_result_id = ? ORDER BY position`
  )
  const engineSamples = db.prepare<
    [string, string, string],
    { id: string; status: string; text: string | null }
  >(
    `SELECT id, status, COALESCE(answer_markdown, answer_text) AS text FROM engine_answers
     WHERE run_id = ? AND prompt_id = ? AND engine = ? ORDER BY sample_no`
  )
  const engineRefs = db.prepare<[string], SourceSql>(
    `SELECT url, normalized_url, domain, title, classification
     FROM engine_sources WHERE answer_id = ? ORDER BY position`
  )
  const citations: Record<string, CitedSource[]> = {}
  const texts = new Map<string, string>()
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all') continue
    const parts = row.id.split(':')
    if (parts.length < 3) continue
    const runId = parts[1] ?? ''
    const promptId = parts.slice(2).join(':')
    if (row.engine === 'google_aio') {
      const samples = googleSamples
        .all(runId, promptId)
        .filter((sample) => isPromptCheckStatus(sample.status))
      const rolled = rollupSamples(
        samples.map((sample) => ({
          sampleNo: sample.sample_no,
          status: sample.status as never,
          named: null,
          citedUrl: null,
          position: null,
          aioText: sample.text,
          references: []
        }))
      )
      const winner = samples.find((sample) => sample.sample_no === rolled.winning?.sampleNo)
      if (winner === undefined) continue
      if (winner.text !== null && winner.text.trim().length > 0) texts.set(row.id, winner.text)
      citations[row.id] = uniqueSources(
        googleRefs.all(winner.id).map((ref) => sourceOf(ref, ref.source_type))
      )
    } else {
      const samples = engineSamples
        .all(runId, promptId, row.engine)
        .filter((sample) => isEngineAnswerStatus(sample.status))
      const best = rollUpStatus(samples.map((sample) => sample.status as never))
      const chosen = samples.filter((sample) => sample.status === best)
      const text = chosen.find((sample) => sample.text !== null && sample.text.trim() !== '')?.text
      if (text !== undefined && text !== null) texts.set(row.id, text)
      citations[row.id] = uniqueSources(
        chosen.flatMap((sample) => engineRefs.all(sample.id).map((ref) => sourceOf(ref, null)))
      )
    }
  }
  return {
    citations,
    blocks: blocksOf(db, texts),
    ...communityFacts(db)
  }
}

interface SourceSql {
  url: string
  normalized_url: string
  domain: string
  title: string | null
  classification: string
}

function whoOf(classification: string): SourceWho {
  if (classification === 'target' || classification === 'own') return 'you'
  if (classification === 'competitor') return 'competitor'
  return 'other'
}

function sourceOf(ref: SourceSql, stored: string | null): CitedSource {
  const type: CitationSourceType =
    stored !== null && isCitationSourceType(stored) ? stored : sourceTypeOf(ref.normalized_url)
  const title = ref.title?.trim() ?? ''
  return {
    url: ref.url,
    domain: cleanHost(ref.domain || ref.url),
    title: title.length > 0 ? title : null,
    who: whoOf(ref.classification),
    type
  }
}

/** Each page once per answer (samples can repeat a page). */
function uniqueSources(list: readonly CitedSource[]): CitedSource[] {
  const seen = new Set<string>()
  return list.filter((source) => {
    const key = source.url.replace(/[?#].*$/, '').replace(/\/+$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Stored classifications by row: the codes, or an empty list when not read yet. */
function blocksOf(
  db: SqliteDatabase,
  texts: ReadonlyMap<string, string>
): Record<string, AnswerShapeCode[]> {
  if (texts.size === 0) return {}
  const hashes = new Map([...texts].map(([rowId, text]) => [rowId, overviewHash(text)]))
  let stored: ReturnType<typeof getAnswerShapes>
  try {
    stored = getAnswerShapes(db, [...hashes.values()])
  } catch {
    // A project file from before the answer_shapes table: every answer waits.
    stored = new Map()
  }
  const out: Record<string, AnswerShapeCode[]> = {}
  for (const [rowId, hash] of hashes) {
    out[rowId] = (stored.get(hash)?.blocks ?? [])
      .map((block) => block.code)
      .filter((code): code is AnswerShapeCode => isAnswerShapeCode(code))
  }
  return out
}

function communityFacts(db: SqliteDatabase): Pick<AnswerExtras, 'videos' | 'threads'> {
  let extras: ReturnType<typeof loadExportSourceExtras>
  try {
    extras = loadExportSourceExtras(db)
  } catch {
    return { videos: {}, threads: {} }
  }
  const videos: Record<string, VideoFacts> = {}
  for (const [id, video] of extras.videos ?? new Map()) {
    videos[id] = {
      title: video.title,
      channel: video.channelTitle,
      views: video.views,
      publishedAt: video.publishedAt
    }
  }
  const threads: Record<string, ThreadFacts> = {}
  for (const [url, thread] of extras.threads ?? new Map()) {
    const id = redditThreadOf(url)?.threadId
    if (id === null || id === undefined) continue
    threads[id.toLowerCase()] = {
      reply: thread.replyState,
      upvotes: thread.upvotes,
      comments: thread.comments
    }
  }
  return { videos, threads }
}
