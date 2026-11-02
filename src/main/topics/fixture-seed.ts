import { normalizeUrl } from '../engine/checks/url'
import type { EngineHost } from '../engine/host'
import {
  finishStoredCheckJob,
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import {
  setPageMarketBaselineRunId,
  setPageMarketFirstCheckNotBefore,
  setPageMarketLastCheckedAt
} from '../storage/pages'
import type { ProjectRecord } from '../storage/records'
import {
  TEXTBOLT_TOPIC_CHECKS,
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_MARKET,
  textboltTopicDraft,
  textboltTopicRuns
} from '@shared/fixtures/textbolt-topic'
import { rejudgeTopicChecks } from './question-targets'
import { writeTopic } from './start'

/**
 * Seeds the TextBolt topic fixture into a project file for e2e runs and
 * renderer previews: the topic, its prompt set, and the two checks (Oct 5 and
 * Oct 19, 2026) stored as runs, captures and references, so `topics:results`,
 * drills, Ask and exports read them like any real check. The project needs the
 * `mkt-us` market. Test and e2e use only.
 */
export function seedTextboltTopic(
  db: SqliteDatabase,
  project: ProjectRecord,
  options: { createId?: () => string; now?: () => Date } = {}
): { topicId: string } {
  let sequence = 0
  const createId = options.createId ?? ((): string => `seed-${(sequence += 1)}`)
  const base = textboltTopicDraft()
  const known = new Set(
    db
      .prepare<unknown[], { id: string }>('SELECT id FROM pages')
      .all()
      .map((row) => row.id)
  )
  // Target pages that are not tracked in this project keep their URL only.
  const prompts = base.prompts.map((prompt) => ({
    ...prompt,
    targetPageId:
      prompt.targetPageId !== null && known.has(prompt.targetPageId) ? prompt.targetPageId : null
  }))
  const draft = { ...base, prompts, projectId: project.id, topicId: TEXTBOLT_TOPIC_ID }
  const host = {
    now: () => new Date('2026-10-04T10:00:00.000Z'),
    createId
  } as unknown as EngineHost
  const env = { host, checks: null, emitProgress: () => undefined }
  const written = writeTopic(
    env,
    { project, db },
    { ...draft, id: `draft-${createId()}` },
    draft.prompts,
    14
  )
  const snapshotId =
    db
      .prepare<unknown[], { id: string }>('SELECT id FROM snapshots WHERE page_id = ? LIMIT 1')
      .get(written.topicId)?.id ?? ''
  for (const [index, run] of textboltTopicRuns().entries()) {
    const check = TEXTBOLT_TOPIC_CHECKS[index]
    if (check === undefined) continue
    const startedAt = new Date(Date.parse(check.finishedAt) - 5 * 60 * 1000).toISOString()
    const jobId = `job-topic-${index + 1}`
    insertStoredCheckJob(db, {
      id: jobId,
      startedAt,
      status: 'running',
      pageIds: [written.topicId],
      marketIds: [TEXTBOLT_TOPIC_MARKET],
      promptIds: null,
      reason: index === 0 ? 'manual' : 'scheduled',
      message: null,
      nextStep: null
    })
    insertStoredRun(db, {
      id: run.runId,
      jobId,
      pageId: written.topicId,
      promptSetId: written.promptSetId,
      snapshotId,
      marketId: TEXTBOLT_TOPIC_MARKET,
      startedAt,
      kind: index === 0 ? 'baseline' : 'scheduled',
      partial: false,
      samples: 1,
      contentHash: 'b'.repeat(64)
    })
    let searches = 0
    for (const [key, outcome] of run.outcomes) {
      const promptId = written.promptIds.get(key)
      if (promptId === undefined || outcome.status === null) continue
      const hasAio = outcome.status !== 'no_aio' && outcome.status !== 'error'
      const own = outcome.references.find((ref) => ref.classification === 'own')
      searches += hasAio ? 2 : 1
      insertStoredSerpResult(db, {
        id: `serp-${run.runId}-${key}`,
        runId: run.runId,
        promptId,
        sampleNo: 1,
        keyId: null,
        hasAio,
        neededFollowup: hasAio,
        searches: hasAio ? 2 : 1,
        status: outcome.status,
        named: outcome.named,
        citedUrl: own?.url ?? null,
        position: own?.position ?? null,
        aioText: hasAio
          ? `AI Overview for this question (fixture, ${check.finishedAt.slice(0, 10)}).`
          : null,
        errorCode: outcome.status === 'error' ? 'timeout' : null,
        message: outcome.status === 'error' ? 'The search timed out.' : null,
        nextStep: outcome.status === 'error' ? 'It runs again on the next check.' : null,
        rawSearchJson: null,
        rawAioJson: null,
        references: outcome.references.map((ref) => ({
          id: `ref-${run.runId}-${key}-${ref.position}`,
          position: ref.position,
          url: ref.url,
          normalizedUrl: normalizeUrl(ref.url) ?? ref.normalizedUrl,
          domain: ref.domain,
          title: null,
          classification: ref.classification,
          untracked: ref.classification === 'own',
          sourceType: ref.domain.includes('reddit') ? 'reddit' : 'web'
        }))
      })
    }
    finishStoredRun(db, run.runId, check.finishedAt, 'finished')
    finishStoredCheckJob(db, jobId, check.finishedAt, 'finished', searches, null, null)
    if (index === 0)
      setPageMarketBaselineRunId(db, written.topicId, TEXTBOLT_TOPIC_MARKET, run.runId)
  }
  // The checks keep their fixture dates (Oct 5 and Oct 19), but the schedule counts
  // from the real seed time: the market reads as checked now, so the topic is due
  // again one interval from now, never at launch, whatever today's date is.
  const seededAt = (options.now ?? ((): Date => new Date()))().toISOString()
  const last = TEXTBOLT_TOPIC_CHECKS[TEXTBOLT_TOPIC_CHECKS.length - 1]?.finishedAt ?? seededAt
  setPageMarketLastCheckedAt(
    db,
    written.topicId,
    TEXTBOLT_TOPIC_MARKET,
    seededAt > last ? seededAt : last
  )
  setPageMarketFirstCheckNotBefore(db, written.topicId, TEXTBOLT_TOPIC_MARKET, null)
  // A real check judges each question by its own pages (Primary + Also OK): do the same,
  // so every screen reads one result.
  rejudgeTopicChecks(db, written.topicId)
  return { topicId: written.topicId }
}

export { TEXTBOLT_TOPIC_ID }
