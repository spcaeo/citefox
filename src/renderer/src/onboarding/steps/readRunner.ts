import type { MutableRefObject } from 'react'
import type {
  FillFound,
  FillFromWebsiteProgress,
  ProductCompetitorsResult,
  SetupDraft,
  SetupListId
} from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { SiteReadClient } from '../../fill/types'
import type { SetupSectionClient } from '../sectionClient'
import { appendRows, applyFill, applyRows, competitorRows } from '../setupApply'
import { contextFromDraft, rowOf, rulesOf } from '../setupDraft'
import { normalizeCountry, normalizeDomain, normalizeLanguageTag } from '../validate'
import {
  EMPTY_LIVE,
  failedSearches,
  liveFill,
  reduceLive,
  retrying,
  retryRequest,
  searchesSettled,
  type LiveAction,
  type ReadLive
} from './readLive'

/**
 * Step 3's "✦ Read my website", the work behind `useSiteRead`:
 *
 * 1. `projects:fillFromWebsite` (no project yet). Its progress events say each page read,
 *    then what the site sells (`found.site`), then each product's competitor search.
 * 2. As soon as the site read is in, `onboarding:sectionRun` for buyers, then for what
 *    sends them looking (they need what it sells, not the competitors), while the
 *    competitor searches still run.
 * 3. Each search's competitors go into the draft as it finishes; a search that did not
 *    finish shows with "Try again" for that product alone.
 *
 * The step moves on once buyers and triggers are in and every search has finished or
 * failed, or at the soft deadline, whichever comes first; a "Try again" the user started
 * is waited for. Searches still running then keep going and fill in when they finish.
 */

export type ReadStageId = 'pages' | 'site' | 'competitors' | 'buyers' | 'triggers'
export type ReadStageState = 'waiting' | 'running' | 'done' | 'warning'

export interface ReadStage {
  id: ReadStageId
  state: ReadStageState
  /** Epoch ms. Null before the stage starts. */
  startedAt: number | null
  endedAt: number | null
  /** Why a stage ended with a warning, in plain words. */
  note: string | null
}

export interface SiteReadState {
  status: 'idle' | 'running' | 'done' | 'failed'
  stages: readonly ReadStage[]
  /** Pages read so far, and pages tried. */
  pagesRead: number
  pagesTried: number
  /** Why the read failed. Null unless `failed`. */
  error: string | null
  /** What the read found so far. */
  live: ReadLive
  /** Buyers and triggers are in: only competitor searches can still be running. */
  sectionsDone: boolean
  /** Epoch ms when the step stops waiting for competitor searches. Null until they start. */
  deadlineAt: number | null
}

/**
 * How long the step waits for competitor searches once they start. One web search took
 * 100–140 s in the owner's runs (one hit the 180 s limit), and Claude runs 2 calls at once
 * by default, so a third product waits for a free turn and its search ends 4 to 5 minutes
 * in. 150 s covers every one- or two-product read seen; later searches finish in the
 * background and fill in on step 6.
 */
export const SEARCH_SOFT_DEADLINE_MS = 150_000

const STAGES: readonly ReadStageId[] = ['pages', 'site', 'competitors', 'buyers', 'triggers']

export function idleRead(): SiteReadState {
  return {
    status: 'idle',
    stages: STAGES.map((id) => ({
      id,
      state: 'waiting',
      startedAt: null,
      endedAt: null,
      note: null
    })),
    pagesRead: 0,
    pagesTried: 0,
    error: null,
    live: EMPTY_LIVE,
    sectionsDone: false,
    deadlineAt: null
  }
}

export interface ReadDeps {
  client: SiteReadClient
  sections: SetupSectionClient
  /** The newest draft, read when each call starts. */
  draftRef: MutableRefObject<SetupDraft>
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
  /** The read finished (or stopped waiting) and its answers are in the draft. */
  onDone: () => void
}

export interface ReadRunner {
  /** What the runner calls; set from an effect, before any run. */
  setDeps(next: ReadDeps): void
  run(): void
  abandon(): void
  retry(productId: string): void
  /** Moves on now, once only competitor searches are left. */
  finishNow(): void
  attach(): void
  detach(): void
}

interface RunFlags {
  site: boolean
  sectionsStarted: boolean
  sectionsDone: boolean
  deadline: boolean
  finished: boolean
}

const NO_FLAGS: RunFlags = {
  site: false,
  sectionsStarted: false,
  sectionsDone: false,
  deadline: false,
  finished: false
}

export function createReadRunner(
  setState: (update: (was: SiteReadState) => SiteReadState) => void,
  options: { softDeadlineMs?: number; now?: () => number } = {}
): ReadRunner {
  const deps: { current: ReadDeps | null } = { current: null }
  const softDeadline = options.softDeadlineMs ?? SEARCH_SOFT_DEADLINE_MS
  const now = options.now ?? Date.now
  let ticket = 0
  let attached = true
  let live: ReadLive = EMPTY_LIVE
  let flags: RunFlags = { ...NO_FLAGS }
  let domain = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const need = (): ReadDeps => {
    if (deps.current === null) throw new Error('The site read has no client yet.')
    return deps.current
  }
  const current = (mine: number): boolean => attached && ticket === mine
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function stage(
    mine: number,
    id: ReadStageId,
    next: ReadStageState,
    note: string | null = null
  ): void {
    if (!current(mine)) return
    const at = now()
    setState((was) => ({
      ...was,
      stages: was.stages.map((item) =>
        item.id !== id || (item.state === next && item.note === note)
          ? item
          : {
              ...item,
              state: next,
              startedAt: item.startedAt ?? at,
              endedAt: next === 'running' ? null : at,
              note
            }
      )
    }))
  }

  function dispatch(mine: number, action: LiveAction): void {
    if (!current(mine)) return
    live = reduceLive(live, action)
    const next = live
    setState((was) => ({ ...was, live: next }))
    if (!flags.site) return
    if (!searchesSettled(next)) {
      stage(mine, 'competitors', 'running')
      return
    }
    const failed = failedSearches(next).length
    stage(
      mine,
      'competitors',
      failed > 0 ? 'warning' : 'done',
      failed === 0
        ? null
        : `${failed === 1 ? 'One search' : `${failed} searches`} didn’t finish. You can try again or go on with what was found.`
    )
  }

  function toDraft(mine: number, update: (draft: SetupDraft) => SetupDraft): void {
    if (!current(mine)) return
    const { draftRef, onDraft } = need()
    draftRef.current = update(draftRef.current)
    onDraft(update)
  }

  function addCompetitors(mine: number, rows: ProductCompetitorsResult['competitors']): void {
    if (rows.length === 0) return
    const products = live.site?.products ?? []
    toDraft(mine, (draft) => appendRows(draft, 'competitors', competitorRows(products, rows)))
  }

  function finish(mine: number): void {
    if (!current(mine) || flags.finished) return
    flags.finished = true
    clearTimer()
    need().onDraft((was) => ({ ...was, readWay: 'claude', readDone: true }))
    setState((was) => ({ ...was, status: 'done' }))
    need().onDone()
  }

  function maybeFinish(mine: number): void {
    if (!current(mine) || flags.finished || !flags.sectionsDone) return
    if (retrying(live)) return
    if (!searchesSettled(live) && !flags.deadline) return
    finish(mine)
  }

  async function section(mine: number, list: SetupListId & ('buyers' | 'triggers')): Promise<void> {
    stage(mine, list, 'running')
    const draft = need().draftRef.current
    try {
      const result = await need().sections.sectionRun({
        section: list,
        context: contextFromDraft(draft),
        mode: 'redo',
        instruction: null,
        current: draft.lists[list].filter((item) => item.origin === 'user').map(rowOf),
        prompt: draft.prompts[list] ?? null,
        ...rulesOf(draft)
      })
      if (!current(mine)) return
      toDraft(mine, (was) => applyRows(was, list, result.rows))
      dispatch(mine, { type: 'rows', list, names: result.rows.map((row) => row.name) })
      stage(mine, list, result.warnings.length > 0 ? 'warning' : 'done', result.warnings[0] ?? null)
    } catch (cause) {
      stage(mine, list, 'warning', errorText(cause, 'CiteFox AI could not answer this part.'))
    }
  }

  function startSections(mine: number): void {
    if (flags.sectionsStarted) return
    flags.sectionsStarted = true
    void (async () => {
      await section(mine, 'buyers')
      if (!current(mine)) return
      await section(mine, 'triggers')
      if (!current(mine)) return
      flags.sectionsDone = true
      setState((was) => ({ ...was, sectionsDone: true }))
      maybeFinish(mine)
    })()
  }

  function onFound(mine: number, found: FillFound): void {
    if (found.kind === 'search') {
      dispatch(mine, { type: 'search', found, at: now() })
      if (found.state === 'done') addCompetitors(mine, found.competitors)
      maybeFinish(mine)
      return
    }
    flags.site = true
    stage(mine, 'pages', 'done')
    const nothing = found.products.length === 0 && found.brands.length === 0
    stage(mine, 'site', nothing ? 'warning' : 'done')
    dispatch(mine, { type: 'site', found })
    // A fresh read: its rows replace the last read's untouched AI rows (no competitors yet).
    toDraft(mine, (draft) => applyFill(draft, liveFill(live, domain)))
    const deadlineAt = now() + softDeadline
    setState((was) => ({ ...was, deadlineAt }))
    clearTimer()
    timer = setTimeout(() => {
      flags.deadline = true
      maybeFinish(mine)
    }, softDeadline)
    startSections(mine)
  }

  function onProgress(mine: number, event: FillFromWebsiteProgress): void {
    if (!current(mine)) return
    if (event.found !== undefined) {
      onFound(mine, event.found)
    } else if (event.phase === 'fetch') {
      setState((was) => ({
        ...was,
        pagesTried: was.pagesTried + (event.state === 'running' ? 1 : 0),
        pagesRead: was.pagesRead + (event.state === 'ok' ? 1 : 0)
      }))
    } else if (event.phase === 'suggest' && event.state === 'running' && !flags.site) {
      stage(mine, 'pages', 'done')
      stage(mine, 'site', 'running')
    }
  }

  function run(): void {
    const mine = ++ticket
    clearTimer()
    flags = { ...NO_FLAGS }
    live = EMPTY_LIVE
    const { client, draftRef } = need()
    const site = draftRef.current.site
    domain = normalizeDomain(site.domain)
    setState(() => ({ ...idleRead(), status: 'running' }))
    stage(mine, 'pages', 'running')
    const stop = client.onFillProgress((event) => onProgress(mine, event))
    const country = site.country === 'other' ? site.countryCode : site.country
    const language = site.language === 'other' ? site.languageCode : site.language
    void (async () => {
      try {
        const fill = await client.fillFromWebsite({
          projectId: null,
          domain,
          market: { country: normalizeCountry(country), language: normalizeLanguageTag(language) }
        })
        stop()
        if (!current(mine)) return
        stage(mine, 'pages', 'done')
        if (flags.site) {
          dispatch(mine, { type: 'final', fill, at: now() })
          // Anything the events did not bring.
          addCompetitors(mine, fill.competitors)
        } else {
          // A read that sent no live events: its answer at once, as before.
          const empty = fill.brands.length === 0 && (fill.products ?? []).length === 0
          stage(mine, 'site', empty ? 'warning' : 'done', empty ? fill.message : null)
          flags.site = true
          dispatch(mine, { type: 'final', fill, at: now() })
          if ((fill.products ?? []).length === 0) {
            stage(mine, 'competitors', 'warning', 'No competitor search ran.')
          }
          toDraft(mine, (draft) => applyFill(draft, fill))
          startSections(mine)
        }
        maybeFinish(mine)
      } catch (cause) {
        stop()
        if (!current(mine)) return
        if (flags.site) {
          // The site read is in; only the searches still open are lost.
          dispatch(mine, {
            type: 'lost',
            note: errorText(cause, 'The read stopped before this search finished.'),
            at: now()
          })
          maybeFinish(mine)
          return
        }
        setState((was) => ({
          ...was,
          status: 'failed',
          error: errorText(cause, 'CiteFox could not read that website.')
        }))
      }
    })()
  }

  function retry(productId: string): void {
    const mine = ticket
    const request = retryRequest(live, domain, productId)
    if (request === null || !current(mine)) return
    dispatch(mine, { type: 'retry', productId, at: now() })
    const settle = (result: ProductCompetitorsResult): void => {
      if (!current(mine)) return
      dispatch(mine, { type: 'retried', result, at: now() })
      if (result.ok) addCompetitors(mine, result.competitors)
      maybeFinish(mine)
    }
    need()
      .client.searchProductCompetitors(request)
      .then(settle, (cause: unknown) =>
        settle({
          productId,
          ok: false,
          competitors: [],
          note: errorText(cause, 'CiteFox AI did not finish this search.')
        })
      )
  }

  return {
    setDeps(next) {
      deps.current = next
    },
    run,
    retry,
    abandon() {
      ticket += 1
      clearTimer()
      flags = { ...NO_FLAGS }
      live = EMPTY_LIVE
      setState(() => idleRead())
    },
    finishNow() {
      if (flags.sectionsDone) finish(ticket)
    },
    attach() {
      attached = true
    },
    detach() {
      attached = false
    }
  }
}

/** Share of the read that is done, for the bar: finished stages, plus half of a running one. */
export function readFraction(stages: readonly ReadStage[]): number {
  if (stages.length === 0) return 0
  const done = stages.filter((stage) => stage.state === 'done' || stage.state === 'warning').length
  const running = stages.some((stage) => stage.state === 'running') ? 0.5 : 0
  return Math.min(1, (done + running) / stages.length)
}
