import { rejudgeTopicChecks } from './question-targets'
import { matchTrackedTopic } from './match-tracked'
import {
  TOPIC_STEPS,
  type IpcInvokeMap,
  type TopicResults,
  type TopicStep,
  type topicsChannels
} from '@shared/ipc'
import {
  isAnswerEngineId,
  isEngineId,
  type AnswerEngineId,
  type TopicTemplateKind
} from '@shared/domain'
import type { CheckEngine } from '../engine/checks/engine'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { emitMainEvent } from '../ipc-events'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { getPage, updateStoredPage } from '../storage/pages'
import { topicStepLabel } from './claude'
import {
  applyDraftPatch,
  createDraft,
  discardDraft,
  keywordSummary,
  listDrafts,
  requireDraft,
  saveDraft,
  searchesLeftFor,
  TopicInputError
} from './drafts'
import type { OpenedProject, TopicEnv } from './env'
import { draftFix, explainCitation, topicSummary, whyNotCited } from './insights'
import {
  draftRequest,
  id,
  optionalId,
  parseBands,
  parseCreateDraft,
  parseIds,
  parseInterval,
  parsePatch,
  parsePlan,
  parseScope,
  parseStep,
  parseTarget,
  projectRequest,
  record,
  text,
  topicRequest
} from './parse'
import {
  cancelPendingTopicBatches,
  getTopic,
  listAllTopicPrompts,
  setTopicBands,
  setTopicPromptTarget,
  setTopicPromptAlso
} from './records'
import { listTopicSummaries, loadTopicResults, TopicNotFoundError } from './results'
import { estimateTopic, startTopic } from './start'
import { saveTopicTargetPage } from './target-page'
import { suggestTopicTarget, topicTargetSuggestions } from './target-suggest'
import {
  competitorQuestions,
  cleanupWithClaude,
  discoverTerms,
  generateKeywords,
  importQuestions,
  mergeNearDuplicates,
  readCompetitorPage,
  readCsvColumns,
  suggestMissingGroups
} from './steps-keywords'
import {
  draftPageBrief,
  matchPages,
  pageCandidates,
  resolveTarget,
  setDraftTarget
} from './steps-pages'
import {
  discoverProfileSection,
  discoverStageQuestions,
  findJourneyGaps,
  generateQuestions,
  rewriteQuestion,
  rewriteSection,
  writeProfile
} from './steps-profile'
import { discoverSeed } from './steps-seed'
import { suggestedStart } from './suggested-start'

export type TopicChannel = keyof typeof topicsChannels

/** One function per `topics:*` invoke. Each parses its own request. */
export type TopicsService = {
  [C in TopicChannel]: (request: unknown) => Promise<IpcInvokeMap[C]['result']>
}

const STEP_KIND: Readonly<Record<TopicStep, TopicTemplateKind>> = {
  suggested_start: 'topic_seed_discover',
  seed_discover: 'topic_seed_discover',
  buyer_profile: 'topic_buyer_profile',
  profile_discover: 'topic_profile_discover_v2',
  journey_questions: 'topic_journey_questions',
  questions_discover: 'topic_questions_discover',
  journey_gaps: 'topic_questions_discover',
  question_rewrite: 'topic_questions_discover',
  keyword_terms: 'topic_keyword_terms',
  keyword_expand: 'topic_keyword_expand',
  keyword_groups: 'topic_keyword_expand',
  questions_cleanup: 'topic_questions_cleanup',
  competitor_questions: 'competitor_page_questions',
  page_match: 'topic_page_match',
  page_brief: 'topic_page_brief',
  target_suggest: 'topic_target_suggest',
  why_not_cited: 'topic_citation_diagnosis',
  draft_fix: 'topic_fix_draft',
  topic_summary: 'topic_summary',
  explain_citation: 'topic_citation_diagnosis'
}

const READS_SITE = new Set<TopicStep>([
  'suggested_start',
  'seed_discover',
  'buyer_profile',
  'profile_discover',
  'keyword_terms',
  'competitor_questions'
])

/**
 * Builds the topics service. `emitProgress` defaults to the main IPC emitter;
 * tests pass their own. Topic errors become plain-words IPC errors.
 */
export function createTopicsService(
  host: EngineHost,
  checks: CheckEngine | null,
  emitProgress: TopicEnv['emitProgress'] = (event) => {
    emitMainEvent('topics:progress', event)
  }
): TopicsService {
  const env: TopicEnv = { host, checks, emitProgress }
  const open = <T>(
    channel: string,
    projectId: string,
    run: (opened: OpenedProject) => Promise<T> | T
  ): Promise<T> =>
    withProject(host, projectId, channel, async (opened) => {
      try {
        return await run({ project: opened.project, db: opened.db })
      } catch (error) {
        if (error instanceof TopicInputError)
          throw new IpcRequestError(channel, error.message, error.nextStep)
        if (error instanceof TopicNotFoundError) throw new IpcRequestError(channel, error.message)
        throw error
      }
    })
  const withDraft = <T>(
    channel: string,
    request: unknown,
    run: (
      opened: OpenedProject,
      draft: ReturnType<typeof requireDraft>,
      raw: Record<string, unknown>
    ) => Promise<T> | T
  ): Promise<T> => {
    const raw = record(request, channel)
    const { projectId, draftId } = draftRequest(raw, channel)
    return open(channel, projectId, (opened) =>
      run(opened, requireDraft(opened.db, projectId, draftId), raw)
    )
  }
  const results = (
    opened: OpenedProject,
    topicId: string,
    marketId: string | null,
    runId: string | null,
    engine: AnswerEngineId | null = null
  ): TopicResults =>
    loadTopicResults(opened.db, {
      projectId: opened.project.id,
      topicId,
      marketId,
      runId,
      domain: opened.project.domain,
      builtAt: host.now().toISOString(),
      engine
    })
  const deps = { now: host.now, createId: host.createId }
  const promptRequest = (
    channel: string,
    request: unknown
  ): {
    projectId: string
    topicId: string
    promptId: string
    marketId: string | null
    runId: string | null
  } => {
    const raw = record(request, channel)
    const { projectId, topicId } = topicRequest(raw, channel)
    return {
      projectId,
      topicId,
      promptId: id(raw, 'promptId', channel),
      marketId: optionalId(raw, 'marketId', channel),
      runId: optionalId(raw, 'runId', channel)
    }
  }

  return {
    'topics:list': (request) => {
      const { projectId } = projectRequest(request, 'topics:list')
      return open('topics:list', projectId, (opened) => ({
        topics: listTopicSummaries(opened.db, {
          projectId,
          domain: opened.project.domain,
          builtAt: host.now().toISOString()
        })
      }))
    },
    'topics:update': (request) => {
      const channel = 'topics:update'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      return open(channel, projectId, (opened) => {
        const page = getPage(opened.db, topicId, projectId)
        if (page === null || page.kind !== 'topic' || getTopic(opened.db, topicId) === null)
          throw new TopicNotFoundError()
        const now = host.now().toISOString()
        if (raw.bands !== undefined)
          setTopicBands(opened.db, topicId, parseBands(raw.bands, channel), now)
        const status = raw.status
        if (
          status !== undefined &&
          status !== 'tracked' &&
          status !== 'paused' &&
          status !== 'removed'
        )
          throw new IpcRequestError(channel)
        const interval = parseInterval(raw.intervalDays, channel)
        const name =
          raw.name === undefined ? undefined : text(raw, 'name', channel, 300, false).trim()
        if (raw.targetPage !== undefined) {
          if (raw.targetPage !== null && typeof raw.targetPage !== 'string')
            throw new IpcRequestError(channel)
          saveTopicTargetPage(opened.db, {
            topicId,
            domain: opened.project.domain,
            value: raw.targetPage === null ? null : raw.targetPage.slice(0, 2000),
            now
          })
          // Saved checks follow the new page at once (no search).
          rejudgeTopicChecks(opened.db, topicId)
        }
        updateStoredPage(opened.db, topicId, projectId, {
          ...(name === undefined ? {} : { title: name, label: name.slice(0, 80) }),
          ...(interval === undefined ? {} : { intervalDays: interval }),
          ...(status === undefined ? {} : { status })
        })
        if (status === 'removed' || status === 'paused')
          cancelPendingTopicBatches(opened.db, topicId, now)
        const summary = listTopicSummaries(opened.db, {
          projectId,
          domain: opened.project.domain,
          builtAt: now
        }).find((item) => item.id === topicId)
        if (summary === undefined) throw new TopicNotFoundError()
        return summary
      })
    },
    'topics:describeStep': (request) => {
      const channel = 'topics:describeStep'
      const raw = record(request, channel)
      const projectId = id(raw, 'projectId', channel)
      const step = parseStep(raw.step, channel)
      return Promise.resolve({
        step,
        label: topicStepLabel(host, projectId, STEP_KIND[step]),
        reads: READS_SITE.has(step) ? 'Uses your site, no searches' : 'No new searches',
        searchCost: 0 as const
      })
    },
    'topics:suggestedStart': (request) => {
      const { projectId } = projectRequest(request, 'topics:suggestedStart')
      return open('topics:suggestedStart', projectId, (opened) => suggestedStart(env, opened))
    },
    'topics:listDrafts': (request) => {
      const { projectId } = projectRequest(request, 'topics:listDrafts')
      return open('topics:listDrafts', projectId, (opened) => ({
        drafts: listDrafts(opened.db, projectId)
      }))
    },
    'topics:createDraft': (request) => {
      const parsed = parseCreateDraft(request, 'topics:createDraft')
      return open('topics:createDraft', parsed.projectId, (opened) =>
        createDraft(opened.db, opened.project, parsed, deps)
      )
    },
    'topics:getDraft': (request) =>
      withDraft('topics:getDraft', request, (_opened, draft) => draft),
    'topics:updateDraft': (request) =>
      withDraft('topics:updateDraft', request, (opened, draft, raw) =>
        saveDraft(
          opened.db,
          applyDraftPatch(draft, parsePatch(raw.patch, 'topics:updateDraft'), deps),
          host.now()
        )
      ),
    'topics:discardDraft': (request) =>
      withDraft('topics:discardDraft', request, (opened, draft) => {
        discardDraft(opened.db, opened.project.id, draft.id, host.now())
        return { drafts: listDrafts(opened.db, opened.project.id) }
      }),
    'topics:discoverSeed': (request) =>
      withDraft('topics:discoverSeed', request, (opened, draft) =>
        discoverSeed(env, opened, draft)
      ),
    'topics:writeProfile': (request) =>
      withDraft('topics:writeProfile', request, (opened, draft, raw) =>
        writeProfile(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          rewrite: raw.rewrite === true,
          instruction:
            raw.instruction === undefined || raw.instruction === null
              ? null
              : text(raw, 'instruction', 'topics:writeProfile', 1000)
        })
      ),
    'topics:discoverProfileSection': (request) =>
      withDraft('topics:discoverProfileSection', request, (opened, draft, raw) => {
        const channel = 'topics:discoverProfileSection'
        const section = raw.section === null ? null : parseSection(raw.section, channel)
        const action = raw.action
        if (
          action !== 'discover' &&
          action !== 'rewrite' &&
          action !== 'shorter' &&
          action !== 'explain'
        )
          throw new IpcRequestError(channel)
        return discoverProfileSection(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          section,
          action,
          instruction:
            raw.instruction === undefined || raw.instruction === null
              ? null
              : text(raw, 'instruction', channel, 1000)
        })
      }),
    'topics:rewriteSection': (request) =>
      withDraft('topics:rewriteSection', request, (opened, draft, raw) => {
        const channel = 'topics:rewriteSection'
        const mode = raw.mode
        if (mode !== 'rewrite' && mode !== 'shorter') throw new IpcRequestError(channel)
        return rewriteSection(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          section: parseSection(raw.section, channel),
          mode,
          instruction:
            raw.instruction === undefined || raw.instruction === null
              ? null
              : text(raw, 'instruction', channel, 1000)
        })
      }),
    'topics:generateQuestions': (request) =>
      withDraft('topics:generateQuestions', request, (opened, draft, raw) =>
        generateQuestions(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          replace: raw.replace !== false
        })
      ),
    'topics:discoverStageQuestions': (request) =>
      withDraft('topics:discoverStageQuestions', request, (opened, draft, raw) => {
        const channel = 'topics:discoverStageQuestions'
        const count = raw.count === undefined ? 5 : raw.count
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 20)
          throw new IpcRequestError(channel)
        return discoverStageQuestions(env, opened, draft, parseStage(raw.stage, channel), count)
      }),
    'topics:findJourneyGaps': (request) =>
      withDraft('topics:findJourneyGaps', request, (opened, draft) =>
        findJourneyGaps(env, opened, draft)
      ),
    'topics:rewriteQuestion': (request) =>
      withDraft('topics:rewriteQuestion', request, (opened, draft, raw) =>
        rewriteQuestion(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          promptIds: parseIds(raw.promptIds, 'topics:rewriteQuestion', 60),
          instruction:
            raw.instruction === undefined || raw.instruction === null
              ? null
              : text(raw, 'instruction', 'topics:rewriteQuestion', 1000)
        })
      ),
    'topics:discoverTerms': (request) =>
      withDraft('topics:discoverTerms', request, (opened, draft) =>
        discoverTerms(env, opened, draft)
      ),
    'topics:generateKeywords': (request) =>
      withDraft('topics:generateKeywords', request, (opened, draft, raw) =>
        generateKeywords(env, opened, draft, raw.replace !== false)
      ),
    'topics:suggestMissingGroups': (request) =>
      withDraft('topics:suggestMissingGroups', request, (opened, draft) =>
        suggestMissingGroups(env, opened, draft)
      ),
    'topics:mergeNearDuplicates': (request) =>
      withDraft('topics:mergeNearDuplicates', request, (opened, draft, raw) =>
        mergeNearDuplicates(env, opened, draft, raw.apply === true)
      ),
    'topics:keywordSummary': (request) =>
      withDraft('topics:keywordSummary', request, (opened, draft) =>
        keywordSummary(
          draft,
          searchesLeftFor(host.storage, opened.db, opened.project.id, host.now())
        )
      ),
    'topics:readCsvColumns': (request) => {
      const channel = 'topics:readCsvColumns'
      const raw = record(request, channel)
      id(raw, 'projectId', channel)
      return Promise.resolve(readCsvColumns(text(raw, 'content', channel, 2_000_000)))
    },
    'topics:importQuestions': (request) =>
      withDraft('topics:importQuestions', request, (opened, draft, raw) => {
        const channel = 'topics:importQuestions'
        const csv = raw.csv === undefined || raw.csv === null ? null : record(raw.csv, channel)
        const mapping = csv === null ? null : record(csv.mapping, channel)
        const column = (value: unknown): number | null => {
          if (value === undefined || value === null) return null
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 200)
            throw new IpcRequestError(channel)
          return value
        }
        return importQuestions(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          text:
            raw.text === undefined || raw.text === null
              ? null
              : text(raw, 'text', channel, 500_000),
          csv:
            csv === null || mapping === null
              ? null
              : {
                  fileName: text(csv, 'fileName', channel, 300),
                  content: text(csv, 'content', channel, 2_000_000),
                  mapping: {
                    question: column(mapping.question) ?? 0,
                    source: column(mapping.source),
                    notes: column(mapping.notes),
                    hasHeader: mapping.hasHeader === true
                  }
                },
          append: raw.append === true
        })
      }),
    'topics:cleanupWithClaude': (request) =>
      withDraft('topics:cleanupWithClaude', request, (opened, draft) =>
        cleanupWithClaude(env, opened, draft)
      ),
    'topics:readCompetitorPage': (request) =>
      withDraft('topics:readCompetitorPage', request, (opened, draft, raw) =>
        readCompetitorPage(
          env,
          opened,
          draft,
          text(raw, 'url', 'topics:readCompetitorPage', 2000, false)
        )
      ),
    'topics:competitorQuestions': (request) =>
      withDraft('topics:competitorQuestions', request, (opened, draft, raw) =>
        competitorQuestions(
          env,
          opened,
          draft,
          optionalId(raw, 'marketId', 'topics:competitorQuestions')
        )
      ),
    'topics:pageCandidates': (request) => {
      const { projectId } = projectRequest(request, 'topics:pageCandidates')
      return open('topics:pageCandidates', projectId, (opened) =>
        pageCandidates(opened.db, projectId)
      )
    },
    'topics:targetSuggestions': (request) => {
      const channel = 'topics:targetSuggestions'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      const marketId = optionalId(raw, 'marketId', channel)
      return open(channel, projectId, (opened) =>
        topicTargetSuggestions(opened.db, {
          projectId,
          topicId,
          marketId,
          domain: opened.project.domain
        })
      )
    },
    'topics:suggestTarget': (request) => {
      const channel = 'topics:suggestTarget'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      const marketId = optionalId(raw, 'marketId', channel)
      return open(channel, projectId, (opened) =>
        suggestTopicTarget(env, opened, { topicId, marketId })
      )
    },
    'topics:matchTracked': (request) => {
      const channel = 'topics:matchTracked'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      const marketId = optionalId(raw, 'marketId', channel)
      return open(channel, projectId, async (opened) => {
        const result = await matchTrackedTopic(env, opened, { projectId, topicId, marketId })
        rejudgeTopicChecks(opened.db, topicId)
        return result
      })
    },
    'topics:matchPages': (request) =>
      withDraft('topics:matchPages', request, (opened, draft, raw) =>
        matchPages(
          env,
          opened,
          draft,
          raw.promptIds === undefined || raw.promptIds === null
            ? null
            : parseIds(raw.promptIds, 'topics:matchPages')
        )
      ),
    'topics:setTarget': (request) => {
      const channel = 'topics:setTarget'
      const raw = record(request, channel)
      const projectId = id(raw, 'projectId', channel)
      const draftId = optionalId(raw, 'draftId', channel)
      const topicId = optionalId(raw, 'topicId', channel)
      const promptIds = parseIds(raw.promptIds, channel)
      const target = parseTarget(raw.target, channel)
      const alsoUrls =
        raw.alsoUrls === undefined || raw.alsoUrls === null
          ? null
          : parseIds(raw.alsoUrls, channel, 10).map((url) => {
              if (url.length > 2000 || !/^https?:\/\//u.test(url))
                throw new IpcRequestError(channel)
              return url
            })
      if ((draftId === null) === (topicId === null))
        throw new IpcRequestError(channel, 'Name a draft or a topic')
      return open(channel, projectId, (opened) => {
        if (draftId !== null) {
          const draft = setDraftTarget(
            env,
            opened,
            requireDraft(opened.db, projectId, draftId),
            promptIds,
            target
          )
          return { draft, rows: [] }
        }
        const rows = listAllTopicPrompts(opened.db, topicId ?? '')
        const wanted = new Set(promptIds)
        const keys = new Set(
          rows
            .filter((row) => wanted.has(row.promptId) || wanted.has(row.stableKey))
            .map((row) => row.stableKey)
        )
        if (keys.size === 0) throw new TopicInputError('Those questions are not in this topic.')
        const resolved = target === undefined ? null : resolveTarget(opened.db, projectId, target)
        const changed: {
          promptId: string
          targetPageId: string | null
          targetUrl: string | null
        }[] = []
        for (const row of rows) {
          if (!keys.has(row.stableKey)) continue
          const next = resolved ?? { pageId: row.targetPageId, url: row.targetUrl }
          setTopicPromptTarget(opened.db, row.promptId, {
            pageId: next.pageId,
            url: next.url,
            confidence: resolved === null ? row.matchConfidence : next.url === null ? null : 100,
            reason:
              resolved === null
                ? row.matchReason
                : next.url === null
                  ? 'You set no page yet.'
                  : 'You picked this page.',
            setBy: 'user',
            confirmed: true
          })
          if (alsoUrls !== null) setTopicPromptAlso(opened.db, row.promptId, alsoUrls)
          if (wanted.has(row.promptId) || wanted.has(row.stableKey))
            changed.push({ promptId: row.promptId, targetPageId: next.pageId, targetUrl: next.url })
        }
        rejudgeTopicChecks(opened.db, topicId ?? '')
        return { draft: null, rows: changed }
      })
    },
    'topics:draftPageBrief': (request) => {
      const channel = 'topics:draftPageBrief'
      const raw = record(request, channel)
      const projectId = id(raw, 'projectId', channel)
      const draftId = optionalId(raw, 'draftId', channel)
      const topicId = optionalId(raw, 'topicId', channel)
      const promptId = id(raw, 'promptId', channel)
      const marketId = optionalId(raw, 'marketId', channel)
      return open(channel, projectId, async (opened) => {
        if (topicId !== null) {
          const loaded = results(opened, topicId, marketId, null)
          const row = loaded.rows.find(
            (item) => item.promptId === promptId || item.stableKey === promptId
          )
          if (row === undefined) throw new TopicInputError('That question is not in this topic.')
          return draftPageBrief(env, opened, {
            prompt: row.text,
            stage: row.stage,
            targetUrl: row.targetUrl,
            targetPageId: row.targetPageId,
            brands:
              loaded.topic.brand === undefined
                ? []
                : [loaded.topic.brand.name, ...loaded.topic.brand.aliases],
            website: opened.project.domain,
            citedNow: row.citedInstead,
            aioText: row.aioSummary,
            promptId: row.promptId,
            pageId: topicId,
            marketId: loaded.topic.marketId,
            runId: row.runId
          })
        }
        if (draftId === null) throw new IpcRequestError(channel, 'Name a draft or a topic')
        const draft = requireDraft(opened.db, projectId, draftId)
        const prompt = draft.prompts.find((item) => item.id === promptId)
        if (prompt === undefined) throw new TopicInputError('That question is not in this draft.')
        return draftPageBrief(env, opened, {
          prompt: prompt.text,
          stage: prompt.stage,
          targetUrl: prompt.targetUrl,
          targetPageId: prompt.targetPageId,
          brands: draft.brandNames,
          website: draft.website,
          citedNow: [],
          aioText: null,
          promptId: prompt.id,
          pageId: draft.topicId,
          marketId: draft.marketIds[0] ?? null,
          runId: null
        })
      })
    },
    'topics:estimate': (request) =>
      withDraft('topics:estimate', request, (opened, draft, raw) =>
        estimateTopic(env, opened, draft, parseScope(raw.scope, 'topics:estimate'))
      ),
    'topics:start': (request) =>
      withDraft('topics:start', request, (opened, draft, raw) => {
        const channel = 'topics:start'
        const stage =
          raw.stage === undefined || raw.stage === null ? null : parseStage(raw.stage, channel)
        const group =
          raw.group === undefined || raw.group === null ? null : text(raw, 'group', channel, 120)
        const scope = parseScope(raw.scope, channel)
        const intervalDays = parseInterval(raw.intervalDays, channel)
        return startTopic(env, opened, draft, {
          projectId: opened.project.id,
          draftId: draft.id,
          plan: parsePlan(raw.plan, channel),
          ...(scope === undefined ? {} : { scope }),
          stage,
          group,
          ...(intervalDays === undefined ? {} : { intervalDays })
        })
      }),
    'topics:results': (request) => {
      const channel = 'topics:results'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      // Absent, null or Google AI Overview: Google's results; another engine its answers.
      const engine = raw.engine
      if (engine !== undefined && engine !== null && !isEngineId(engine)) {
        throw new IpcRequestError(channel)
      }
      return open(channel, projectId, (opened) =>
        results(
          opened,
          topicId,
          optionalId(raw, 'marketId', channel),
          optionalId(raw, 'runId', channel),
          isAnswerEngineId(engine) ? engine : null
        )
      )
    },
    'topics:whyNotCited': (request) => {
      const parsed = promptRequest('topics:whyNotCited', request)
      return open('topics:whyNotCited', parsed.projectId, (opened) =>
        whyNotCited(
          env,
          opened,
          parsed.topicId,
          results(opened, parsed.topicId, parsed.marketId, null),
          parsed.promptId
        )
      )
    },
    'topics:explainCitation': (request) => {
      const parsed = promptRequest('topics:explainCitation', request)
      return open('topics:explainCitation', parsed.projectId, (opened) =>
        explainCitation(
          env,
          opened,
          parsed.topicId,
          results(opened, parsed.topicId, parsed.marketId, parsed.runId),
          parsed.promptId
        )
      )
    },
    'topics:draftFix': (request) => {
      const parsed = promptRequest('topics:draftFix', request)
      return open('topics:draftFix', parsed.projectId, (opened) =>
        draftFix(
          env,
          opened,
          parsed.topicId,
          results(opened, parsed.topicId, parsed.marketId, null),
          parsed.promptId
        )
      )
    },
    'topics:topicSummary': (request) => {
      const channel = 'topics:topicSummary'
      const raw = record(request, channel)
      const { projectId, topicId } = topicRequest(raw, channel)
      return open(channel, projectId, (opened) => {
        const loaded = results(opened, topicId, optionalId(raw, 'marketId', channel), null)
        if (loaded.progress.length === 0) {
          throw new PipelineError('Check the topic first; there is nothing to summarise yet.', {
            code: 'not_found',
            nextStep: 'Run Check now.'
          })
        }
        return topicSummary(env, opened, topicId, loaded)
      })
    }
  }
}

function parseSection(
  value: unknown,
  channel: string
): Parameters<typeof discoverProfileSection>[3]['section'] & string {
  const sections = ['who', 'environment', 'segments', 'triggers', 'values', 'poor_fit'] as const
  if (typeof value !== 'string' || !(sections as readonly string[]).includes(value))
    throw new IpcRequestError(channel)
  return value as (typeof sections)[number]
}

function parseStage(
  value: unknown,
  channel: string
): 'problem' | 'options' | 'doubts' | 'fit' | 'compare' | 'decide' {
  const stages = ['problem', 'options', 'doubts', 'fit', 'compare', 'decide'] as const
  if (typeof value !== 'string' || !(stages as readonly string[]).includes(value))
    throw new IpcRequestError(channel)
  return value as (typeof stages)[number]
}

export { TOPIC_STEPS }
