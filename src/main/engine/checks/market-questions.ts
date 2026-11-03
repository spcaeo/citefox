import {
  CHECK_SLOWED_NOTICE,
  ENGINE_LABEL,
  ENGINE_SHORT_LABEL,
  unitsCostMicros,
  type AnswerEngineId,
  type EngineAnswerStatus,
  type EngineId
} from '@shared/domain'
import type { CheckItemRef, CitationNews } from '@shared/ipc'
import { googleExtrasFromRaw } from '../../providers/serpapi/extras'
import { insertStoredSerpResult, listStoredSerpResults } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listEngineAnswers } from '../../storage/engine-records'
import { engineStatusOfSample, runAnswerEngines } from './answer-step'
import { CHECK_QUESTIONS_AT_ONCE, runPool } from './check-pace'
import { classifySample, type ClassifiedSample } from './classify'
import type { CaptureQuery } from './capture'
import type { CheckEngineDeps } from './engine'
import { countSearches, resumeCapBlock } from './engine-helpers'
import { answerEnginesOf } from './engines-plan'
import { encodeGoogleExtras } from './google-search'
import {
  askEngines,
  endQuestion,
  engineLanded,
  enginesWaiting,
  itemNumbers,
  startQuestion
} from './in-flight'
import { bumpMarket, emit, markSlowed, promptKey, rememberStep, skipPrompt } from './job-progress'
import { emptyCapture, type CapGate, type EngineRotation } from './key-rotation'
import { markSearching, questionSaved } from './live-results'
import { wordingFor, type MarketPlan, type PagePlan, type PromptPlan } from './plan'
import { competitorsOf, type Prepared } from './prepare'
import { providerPacer } from './provider-pacer'
import { filterFor } from './results'

/**
 * One page × market of a check job: every buyer question, a few at once
 * (`CHECK_QUESTIONS_AT_ONCE`). Inside one question the samples run in turn, and each
 * sample's Google search and answer engines run together. A question is stored and
 * pushed to the screens ("Scored", `results:changed`) the moment it is done, so live rows
 * and the citation celebration do not wait for the others. Once a question stops the job
 * (Stop, the project cap, no key left) no new question starts; the ones in flight finish
 * and are stored, and the outcome says why the job stopped.
 */
export type MarketOutcome = 'done' | 'cancel' | 'project' | 'keys'

export interface MarketQuestionsInput {
  deps: CheckEngineDeps
  db: SqliteDatabase
  prepared: Prepared
  page: PagePlan
  market: MarketPlan
  runId: string
  /** The run was stored before (a resume): its samples and answers are skipped. */
  resumed: boolean
  donePrompts: Set<string>
  tracked: readonly string[]
  rotation: EngineRotation
  /** cloro, for the answer engines; the same rotation when cloro runs Google too. */
  answers: EngineRotation
  gate: CapGate
  control: { requested: boolean }
  /** With no cloro key left, answer engines stop for the rest of the job (every market). */
  answersOff: { value: boolean }
  /** Questions at once. Tests pass 1 for a strict order. */
  atOnce?: number
}

/** The "going slower" line stays on the screens this long after a cooldown ends. */
const SLOWED_NOTICE_LINGER_MS = 15_000

type SampleOutcome = 'ok' | 'error' | 'stop'

export async function checkMarketQuestions(input: MarketQuestionsInput): Promise<MarketOutcome> {
  const { deps, db, prepared, page, market, runId, control, gate, rotation } = input
  const samples = input.resumed
    ? listStoredSerpResults(db, filterFor(prepared.job.projectId, page.pageId, market.id, runId))
    : []
  const storedAnswers = input.resumed ? listEngineAnswers(db, [runId]) : []
  const googleOn = page.engines.includes('google_aio')
  const answerEngines = answerEnginesOf(page.engines)
  // Q9 / K3 as the topic screen numbers them, for the Check window's running list.
  const numbers = itemNumbers(db, page)
  const refOf = (prompt: PromptPlan): CheckItemRef => {
    const found = numbers.get(prompt.id)
    return {
      pageId: page.pageId,
      marketId: market.id,
      promptId: prompt.id,
      kind: found?.kind ?? 'question',
      number: found?.number ?? prompt.position
    }
  }
  /** An engine answered: tick it, and say which ones the question still waits on. */
  const landed = (
    prompt: PromptPlan,
    sampleNo: number,
    engine: EngineId,
    status: EngineAnswerStatus
  ): void => {
    const ref = refOf(prompt)
    engineLanded(prepared.job, ref, engine, status)
    // Google's own steps are pushed by `rememberStep`; with nothing left, scoring is next.
    const waiting = enginesWaiting(prepared.job, ref)
    if (engine === 'google_aio' || waiting.length === 0) return
    emit(
      deps,
      prepared.job,
      page.pageId,
      market.id,
      prompt.id,
      sampleNo,
      'search',
      'running',
      `Searching ${waiting.map((engine) => ENGINE_SHORT_LABEL[engine]).join(', ')}`,
      null,
      null,
      0,
      prompt.textByMarket.get(market.id)
    )
  }
  let halt: Exclude<MarketOutcome, 'done'> | null = null
  // What each question's earlier push already told the screens (see `tellScreens`).
  const told = new Map<string, CitationNews | null>()
  const tellScreens = (promptId: string): void => {
    const before = told.get(promptId) ?? null
    const news = questionSaved(deps, db, prepared, page.pageId, market.id, promptId, before)
    if (before?.kind !== 'cited' && news !== null) told.set(promptId, news)
  }
  const stop = (reason: Exclude<MarketOutcome, 'done'>): 'stop' => {
    halt ??= reason
    return 'stop'
  }
  // A refused call is a cancel unless the project cap refused it.
  const haltReason = (): 'cancel' | 'project' =>
    control.requested || !gate.capHit() ? 'cancel' : 'project'
  const classifier = (
    failed: boolean,
    text: string | null,
    references: readonly { url: string; title: string | null }[]
  ): ClassifiedSample =>
    classifySample({
      failed,
      hasAio: !failed,
      aioText: text,
      references,
      targetUrl: page.url,
      targetPage: page.targetPage,
      ownDomain: prepared.domain,
      includeSubdomains: prepared.includeSubdomains,
      brandNames: prepared.brands,
      competitors: competitorsOf(prepared, page.pageId),
      trackedUrls: input.tracked
    })

  /** Answer engines a resumed run already stored for this question and sample. */
  const storedEngines = (promptId: string, sampleNo: number): Set<AnswerEngineId> =>
    new Set(
      storedAnswers
        .filter((answer) => answer.promptId === promptId && answer.sampleNo === sampleNo)
        .map((answer) => answer.engine)
    )

  /**
   * The selected answer engines for one sample. 'halt' is a cancel or the cap; with no
   * cloro key left, answer engines stop for the rest of the job and Google carries on.
   */
  const answerStep = async (
    prompt: PromptPlan,
    sampleNo: number,
    query: CaptureQuery
  ): Promise<'halt' | 'error' | null> => {
    if (answerEngines.length === 0) return null
    const stored = storedEngines(prompt.id, sampleNo)
    const step = await runAnswerEngines({
      db,
      runId,
      promptId: prompt.id,
      sampleNo,
      query,
      engines: answerEngines,
      stored,
      rotation: input.answers,
      gate,
      pricing: prepared.pricing,
      createId: deps.createId,
      now: () => deps.now().toISOString(),
      classify: classifier,
      cancelled: () => control.requested,
      onLanded: (engine, status) => landed(prompt, sampleNo, engine, status)
    })
    countSearches(prepared, step.searches)
    if (step.stop === 'no_keys' && !input.answersOff.value) {
      input.answersOff.value = true
      deps.logger.warn('answer engines stopped: no cloro key has room', {
        jobId: prepared.job.id
      })
    }
    if (step.stop === 'halted') return 'halt'
    return step.sawError ? 'error' : null
  }

  /** One Google AI Overview capture, classified and stored with its steps. */
  const googleStep = async (
    prompt: PromptPlan,
    sampleNo: number,
    query: CaptureQuery
  ): Promise<SampleOutcome> => {
    const captured = await rotation.capture(query, gate)
    if (captured.exhausted) return stop('keys')
    if (captured.halted && captured.searches === 0) return stop(haltReason())
    if (captured.halted) {
      // The search ran but the follow-up never did. Count the search; store no
      // sample, because an unfinished capture is not "no AIO" (FR-5.5).
      rememberStep(
        deps,
        db,
        prepared.job,
        page,
        market.id,
        prompt,
        sampleNo,
        'search',
        'ok',
        'Loaded',
        captured,
        0
      )
      countSearches(prepared, captured.searches)
      return stop(haltReason())
    }
    const classified = classifySample({
      failed: captured.errorCode !== null,
      hasAio: captured.hasAio,
      aioText: captured.aioText,
      references: captured.references,
      targetUrl: page.url,
      targetPage: page.targetPage,
      targetPages: page.promptTargets?.get(prompt.id) ?? null,
      ownDomain: prepared.domain,
      includeSubdomains: prepared.includeSubdomains,
      brandNames: prepared.brands,
      competitors: competitorsOf(prepared, page.pageId),
      trackedUrls: input.tracked
    })
    landed(prompt, sampleNo, 'google_aio', engineStatusOfSample(classified.status))
    const retries = Math.max(0, captured.searches - (captured.neededFollowup ? 2 : 1))
    const viaCloro = captured.provider === 'cloro'
    insertStoredSerpResult(db, {
      id: deps.createId(),
      runId,
      promptId: prompt.id,
      sampleNo,
      keyId: captured.keyId,
      hasAio: captured.hasAio,
      neededFollowup: captured.neededFollowup,
      searches: captured.searches,
      status: classified.status,
      named: classified.named,
      citedUrl: classified.citedUrl,
      position: classified.position,
      aioText: captured.aioText,
      errorCode: captured.errorCode,
      message: captured.message,
      nextStep: captured.nextStep,
      rawSearchJson: captured.rawSearchJson,
      rawAioJson: captured.rawAioJson,
      googleJson: encodeGoogleExtras(
        captured.extras ?? googleExtrasFromRaw(captured.rawSearchJson)
      ),
      provider: viaCloro ? 'cloro' : 'serpapi',
      credits: captured.credits ?? 0,
      costMicros: unitsCostMicros(
        viaCloro ? (captured.credits ?? 0) : captured.searches,
        prepared.pricing.planFor(captured.keyId, viaCloro ? 'cloro' : 'serpapi')
      ),
      aioMarkdown: captured.markdown ?? null,
      references: classified.references.map((reference) => ({
        ...reference,
        id: deps.createId()
      }))
    })
    const state = captured.errorCode === null ? 'ok' : 'error'
    const searchDetail = state === 'error' ? (captured.message ?? 'Search failed.') : 'Loaded'
    const aioDetail =
      state === 'error'
        ? (captured.message ?? 'Search failed.')
        : !captured.hasAio
          ? 'No AI Overview'
          : captured.neededFollowup
            ? 'Follow-up loaded'
            : 'Loaded'
    rememberStep(
      deps,
      db,
      prepared.job,
      page,
      market.id,
      prompt,
      sampleNo,
      'search',
      state,
      searchDetail,
      captured,
      0
    )
    rememberStep(
      deps,
      db,
      prepared.job,
      page,
      market.id,
      prompt,
      sampleNo,
      'aio',
      state,
      aioDetail,
      captured,
      retries
    )
    countSearches(prepared, captured.searches)
    return state
  }

  /**
   * One sample: Google (unless off, or `fresh` is false because a resume stored it) and
   * the answer engines, side by side.
   */
  const checkSample = async (
    prompt: PromptPlan,
    sampleNo: number,
    query: CaptureQuery,
    fresh: boolean
  ): Promise<SampleOutcome> => {
    const asked = input.answersOff.value
      ? []
      : answerEngines.filter((engine) => !storedEngines(prompt.id, sampleNo).has(engine))
    askEngines(prepared.job, refOf(prompt), fresh && googleOn ? ['google_aio', ...asked] : asked)
    if (!fresh || !googleOn) {
      if (fresh && !input.answersOff.value) {
        const names = answerEngines.map((engine) => ENGINE_LABEL[engine]).join(', ')
        markSearching(deps, db, prepared.job, page, market.id, prompt, sampleNo, names)
      }
      const step = input.answersOff.value ? null : await answerStep(prompt, sampleNo, query)
      if (step === 'halt') return stop(haltReason())
      return step === 'error' ? 'error' : 'ok'
    }
    const blocked = prepared.resume ? resumeCapBlock(deps, prepared, rotation) : null
    if (blocked !== null) return stop(blocked)
    markSearching(deps, db, prepared.job, page, market.id, prompt, sampleNo, 'Google')
    // Google first, so its call is admitted first, then the answer engines beside it.
    const googling = googleStep(prompt, sampleNo, query)
    const answering = input.answersOff.value ? null : answerStep(prompt, sampleNo, query)
    let answered = answering === null
    answering?.then(
      () => {
        answered = true
      },
      () => undefined
    )
    let google: SampleOutcome
    try {
      google = await googling
    } catch (error) {
      await answering?.catch(() => undefined)
      throw error
    }
    // The AI Overview is in: show it (and celebrate a citation) now, not after the
    // slower answer engines or the question's other samples.
    if (google !== 'stop' && (!answered || sampleNo < page.samples)) tellScreens(prompt.id)
    const step = await answering
    if (google === 'stop') return 'stop'
    // A sample whose calls all landed is kept and counted, also when Stop came meanwhile;
    // Stop then ends the question before its next sample (and starts no new question).
    if (step === 'halt') return stop(haltReason())
    return google === 'error' || step === 'error' ? 'error' : 'ok'
  }

  const checkQuestion = async (prompt: PromptPlan): Promise<void> => {
    const key = promptKey(page.pageId, market.id, prompt.id)
    if (input.donePrompts.has(key)) return
    const text = wordingFor(prompt, market, page.defaultMarketId)
    if (text === null) {
      // FR-8.6: never search another language's wording. Record the skip so
      // progress still reaches the total.
      skipPrompt(deps, db, prepared.job, page, market.id, prompt)
      input.donePrompts.add(key)
      return
    }
    prompt.textByMarket.set(market.id, text)
    const query: CaptureQuery = {
      q: text,
      gl: market.gl,
      hl: market.hl,
      location: market.location,
      device: market.device
    }
    let sawError = false
    let stopped = false
    const ref = refOf(prompt)
    startQuestion(
      prepared.job,
      {
        ...ref,
        stage: numbers.get(prompt.id)?.stage ?? null,
        text,
        startedAt: deps.now().toISOString()
      },
      prepared.domain
    )
    try {
      for (let sampleNo = 1; sampleNo <= page.samples; sampleNo += 1) {
        const prior = samples.find(
          (sample) => sample.promptId === prompt.id && sample.sampleNo === sampleNo
        )
        if (prior !== undefined && (prior.errorCode !== null || prior.status === 'error')) {
          sawError = true
        }
        if (control.requested) stop('cancel')
        // Stop, or another question stopped the job: leave this one for a resume.
        if (halt !== null) {
          stopped = true
          break
        }
        const outcome = await checkSample(prompt, sampleNo, query, prior === undefined)
        if (outcome === 'stop') {
          stopped = true
          break
        }
        if (outcome === 'error') sawError = true
      }
    } finally {
      endQuestion(prepared.job, ref, deps.now().toISOString(), !stopped)
    }
    if (stopped) return
    const analysis = sawError ? 'warning' : 'ok'
    rememberStep(
      deps,
      db,
      prepared.job,
      page,
      market.id,
      prompt,
      0,
      'analysis',
      analysis,
      'Scored',
      emptyCapture(),
      0
    )
    prepared.job.done += 1
    bumpMarket(prepared.job, market.id)
    input.donePrompts.add(key)
    // Shown at once on the topic page, Summary and Questions (live results).
    tellScreens(prompt.id)
    emit(
      deps,
      prepared.job,
      page.pageId,
      market.id,
      prompt.id,
      null,
      'analysis',
      analysis,
      'Scored',
      null,
      null,
      0
    )
    if (control.requested) stop('cancel')
  }

  // A rate limit slows the whole run down (provider-pacer.ts): tell the screens why it
  // is slower, so a long wait does not look stuck. Nothing is lost; the run carries on.
  const hush = [prepared.provider, 'cloro' as const]
    .filter((provider, index, all) => all.indexOf(provider) === index)
    .map((provider) =>
      providerPacer(deps.storage.db, provider).onSlowed((event) => {
        markSlowed(prepared.job, deps.now().getTime() + event.waitMs + SLOWED_NOTICE_LINGER_MS)
        emit(
          deps,
          prepared.job,
          page.pageId,
          market.id,
          null,
          null,
          'search',
          'running',
          CHECK_SLOWED_NOTICE,
          null,
          null,
          0
        )
      })
    )
  try {
    await runPool(
      page.prompts,
      input.atOnce ?? CHECK_QUESTIONS_AT_ONCE,
      () => halt !== null || control.requested,
      checkQuestion
    )
  } finally {
    for (const stopListening of hush) stopListening()
  }
  return halt ?? (control.requested ? 'cancel' : 'done')
}
