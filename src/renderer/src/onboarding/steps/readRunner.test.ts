import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanySuggestion,
  FillFound,
  FillFromWebsiteProgress,
  FillFromWebsiteResult,
  ProductCompetitorsRequest,
  ProductCompetitorsResult,
  SetupDraft,
  SetupSectionRunRequest
} from '@shared/ipc'
import type { SiteReadClient } from '../../fill/types'
import type { SetupSectionClient } from '../sectionClient'
import { emptySetupDraft } from '../setupDraft'
import { createReadRunner, idleRead, type ReadDeps, type SiteReadState } from './readRunner'

/** A promise and its resolve, for answers the test releases when it wants. */
function later<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (e: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function rival(name: string, product: string): CompanySuggestion {
  return {
    id: `c-${name}`,
    name,
    domain: null,
    domainSource: null,
    reason: 'Same job.',
    evidence: null,
    checkDomain: false,
    product,
    tier: 'direct'
  }
}

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Email-to-SMS',
    job: 'Emails to texts',
    buyer: 'SMBs',
    evidence: null,
    searchNote: null
  },
  {
    id: 'p2',
    name: 'Gateway replacement',
    job: 'Replaces carrier gateways',
    buyer: 'SMBs',
    evidence: null,
    searchNote: null
  }
]

const SITE: FillFound = {
  kind: 'site',
  summary: 'TextBolt turns emails into texts.',
  brands: [{ id: 'b1', name: 'TextBolt', reason: 'Home page.' }],
  products: PRODUCTS,
  comparedWith: ['SimpleTexting'],
  switchingFrom: [],
  integrations: [],
  suggestedMarket: null,
  market: { country: 'US', language: 'en' }
}

function event(found?: FillFound, phase: 'fetch' | 'suggest' = 'suggest'): FillFromWebsiteProgress {
  return {
    domain: 'textbolt.com',
    phase,
    state: phase === 'fetch' ? 'ok' : 'running',
    url: null,
    detail: '',
    nextStep: null,
    ...(found ? { found } : {})
  }
}

function search(
  productId: string,
  state: 'running' | 'done' | 'failed',
  competitors: CompanySuggestion[] = []
): FillFound {
  return {
    kind: 'search',
    productId,
    state,
    competitors,
    note: state === 'failed' ? 'It took too long and was stopped.' : null
  }
}

interface Harness {
  state: () => SiteReadState
  draft: () => SetupDraft
  emit: (event: FillFromWebsiteProgress) => void
  fill: ReturnType<typeof later<FillFromWebsiteResult>>
  retries: {
    request: ProductCompetitorsRequest
    answer: ReturnType<typeof later<ProductCompetitorsResult>>
  }[]
  runs: SetupSectionRunRequest[]
  done: ReturnType<typeof vi.fn>
  runner: ReturnType<typeof createReadRunner>
}

function harness(): Harness {
  let state = idleRead()
  const draftRef = {
    current: {
      ...emptySetupDraft(),
      site: { ...emptySetupDraft().site, domain: 'textbolt.com', country: 'US', language: 'en' }
    }
  }
  let draft = draftRef.current
  let listener: (event: FillFromWebsiteProgress) => void = () => undefined
  const fill = later<FillFromWebsiteResult>()
  const retries: Harness['retries'] = []
  const runs: SetupSectionRunRequest[] = []
  const client: SiteReadClient = {
    fillFromWebsite: () => fill.promise,
    onFillProgress: (next) => {
      listener = next
      return () => {
        listener = () => undefined
      }
    },
    checkCompanyDomain: async () => ({ ok: true, domain: null, message: '' }),
    searchProductCompetitors: (request) => {
      const answer = later<ProductCompetitorsResult>()
      retries.push({ request, answer })
      return answer.promise
    }
  }
  const sections = {
    sectionRun: async (request: SetupSectionRunRequest) => {
      runs.push(request)
      const name = request.section === 'buyers' ? 'IT sysadmin' : 'AT&T gateway shut down'
      return {
        section: request.section,
        rows: [{ name, detail: '', url: null, tag: null }],
        text: null,
        warnings: []
      }
    }
  } as unknown as SetupSectionClient
  const done = vi.fn()
  const runner = createReadRunner(
    (update) => {
      state = update(state)
    },
    { softDeadlineMs: 150_000 }
  )
  runner.setDeps({
    client,
    sections,
    draftRef,
    onDraft: (update: (current: SetupDraft) => SetupDraft) => {
      draft = update(draft)
    },
    onDone: done
  } satisfies ReadDeps)
  return {
    state: () => state,
    draft: () => draft,
    emit: (next) => listener(next),
    fill,
    retries,
    runs,
    done,
    runner
  }
}

const names = (draft: SetupDraft): string[] => draft.lists.competitors.map((row) => row.name)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('step 3 read runner', () => {
  it('starts buyers and triggers as soon as the site read is in, before the searches end', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(undefined, 'fetch'))
    h.emit(event(SITE))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.runs.map((run) => run.section)).toEqual(['buyers', 'triggers'])
    expect(h.runs[0]?.context.products.map((row) => row.name)).toEqual([
      'Email-to-SMS',
      'Gateway replacement'
    ])
    expect(h.state().live.buyers).toEqual(['IT sysadmin'])
    expect(h.state().sectionsDone).toBe(true)
    // Still searching: the step has not moved on.
    expect(h.done).not.toHaveBeenCalled()
    expect(h.state().stages.find((stage) => stage.id === 'competitors')?.state).toBe('running')
  })

  it('adds each search’s competitors to the draft as it finishes, and moves on when all are in', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p1', 'running')))
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    await vi.advanceTimersByTimeAsync(0)
    expect(names(h.draft())).toEqual(['Textmagic'])
    expect(h.done).not.toHaveBeenCalled()
    h.emit(event(search('p2', 'done', [rival('ClickSend', 'p2'), rival('Textmagic', 'p2')])))
    expect(names(h.draft())).toEqual(['Textmagic', 'ClickSend'])
    expect(h.done).toHaveBeenCalledTimes(1)
    expect(h.state().status).toBe('done')
    expect(h.draft().readDone).toBe(true)
  })

  it('moves on at the soft deadline with what was found; a late search still fills in', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    h.emit(event(search('p2', 'running')))
    await vi.advanceTimersByTimeAsync(149_000)
    expect(h.done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.done).toHaveBeenCalledTimes(1)
    expect(names(h.draft())).toEqual(['Textmagic'])
    h.emit(event(search('p2', 'done', [rival('ClickSend', 'p2')])))
    expect(names(h.draft())).toEqual(['Textmagic', 'ClickSend'])
    expect(h.done).toHaveBeenCalledTimes(1)
  })

  it('a failed search does not block; Try again is waited for and lands in the draft', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    h.emit(event(search('p2', 'failed')))
    await vi.advanceTimersByTimeAsync(0)
    // Every search finished or failed: it moves on with the partial list.
    expect(h.done).toHaveBeenCalledTimes(1)
    const competitors = h.state().stages.find((stage) => stage.id === 'competitors')
    expect(competitors?.state).toBe('warning')
    expect(competitors?.note).toMatch(/One search didn’t finish/)

    h.runner.retry('p2')
    expect(h.retries[0]?.request.product).toEqual({
      id: 'p2',
      name: 'Gateway replacement',
      job: 'Replaces carrier gateways',
      buyer: 'SMBs'
    })
    expect(h.state().live.searches[1]).toMatchObject({ state: 'running', retried: true })
    h.retries[0]?.answer.resolve({
      productId: 'p2',
      ok: true,
      competitors: [rival('ClickSend', 'p2')],
      note: null
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state().live.searches[1]?.state).toBe('done')
    expect(names(h.draft())).toEqual(['Textmagic', 'ClickSend'])
  })

  it('waits for a Try again the user started before the step was done', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p2', 'failed')))
    h.runner.retry('p2')
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    await vi.advanceTimersByTimeAsync(200_000)
    expect(h.done).not.toHaveBeenCalled()
    h.retries[0]?.answer.reject(new Error('CiteFox AI timed out'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state().live.searches[1]?.state).toBe('failed')
    expect(h.done).toHaveBeenCalledTimes(1)
  })

  it('Continue moves on at once when only searches are left', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.runner.finishNow()
    expect(h.done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    h.runner.finishNow()
    expect(h.done).toHaveBeenCalledTimes(1)
  })

  it('the read’s own answer settles the rest and adds what the events missed', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    await vi.advanceTimersByTimeAsync(0)
    h.fill.resolve({
      domain: 'textbolt.com',
      pagesRead: [],
      summary: SITE.summary,
      products: PRODUCTS,
      brands: SITE.brands,
      competitors: [rival('Textmagic', 'p1'), rival('Notifyre', 'p2')],
      switchingFrom: [],
      integrations: [],
      suggestedMarket: null,
      message: '',
      nextStep: null
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(names(h.draft())).toEqual(['Textmagic', 'Notifyre'])
    expect(h.done).toHaveBeenCalledTimes(1)
  })

  it('a read that fails after the site read keeps what was found', async () => {
    const h = harness()
    h.runner.run()
    h.emit(event(SITE))
    h.emit(event(search('p1', 'done', [rival('Textmagic', 'p1')])))
    h.fill.reject(new Error('IPC closed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state().status).toBe('done')
    expect(h.state().live.searches[1]?.state).toBe('failed')
    expect(names(h.draft())).toEqual(['Textmagic'])
  })

  it('a read that fails before the site read is a failed read, as before', async () => {
    const h = harness()
    h.runner.run()
    h.fill.reject(new Error('Could not reach textbolt.com'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state().status).toBe('failed')
    expect(h.runs).toEqual([])
  })
})
