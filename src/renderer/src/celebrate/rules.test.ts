import { describe, expect, it } from 'vitest'
import type { CitationNews, ResultsChanged } from '@shared/ipc'
import { celebrationText, createCelebrator } from './rules'

function news(patch: Partial<CitationNews> = {}): CitationNews {
  return {
    kind: 'cited',
    brand: 'TextBolt',
    promptText: 'nagios email to sms replacement',
    position: 2,
    engine: 'google_aio',
    url: 'https://textbolt.com/nagios-sms/',
    firstEver: false,
    ...patch
  }
}

function event(citation: CitationNews | null, jobId = 'job-1'): ResultsChanged {
  return {
    projectId: 'p1',
    jobId,
    pageId: 'g1',
    marketId: 'm1',
    promptId: 'q1',
    state: 'running',
    done: 1,
    total: 12,
    citation
  }
}

function setup(options: { enabled?: boolean } = {}): {
  receive: (citation: CitationNews | null, jobId?: string) => void
  shown: CitationNews[]
  state: { active: boolean; enabled: boolean }
  resume: () => void
} {
  const state = { active: true, enabled: options.enabled ?? true }
  const shown: CitationNews[] = []
  const celebrator = createCelebrator({
    isActive: () => state.active,
    enabled: () => state.enabled,
    show: (item) => shown.push(item)
  })
  return {
    shown,
    state,
    receive: (citation, jobId) => celebrator.receive(event(citation, jobId)),
    resume: () => celebrator.resume()
  }
}

describe('createCelebrator', () => {
  it('celebrates only the first citation of a check', () => {
    const { receive, shown } = setup()
    receive(news({ promptText: 'first' }))
    receive(news({ promptText: 'second', position: 1 }))
    receive(news({ promptText: 'third', engine: 'chatgpt', firstEver: true }))
    expect(shown.map((item) => item.promptText)).toEqual(['first'])
  })

  it('celebrates each check once', () => {
    const { receive, shown } = setup()
    receive(news({ promptText: 'a' }), 'job-1')
    receive(news({ promptText: 'b' }), 'job-2')
    receive(news({ promptText: 'c' }), 'job-1')
    receive(news({ promptText: 'd' }), 'job-2')
    expect(shown.map((item) => item.promptText)).toEqual(['a', 'b'])
  })

  it('stays quiet for named-only, empty results and end events', () => {
    const { receive, shown } = setup()
    receive(news({ kind: 'named', position: null, engine: null }))
    receive(null)
    receive(undefined as unknown as null)
    expect(shown).toEqual([])
    // A named-only result does not use up the check's one celebration.
    receive(news({ promptText: 'linked' }))
    expect(shown.map((item) => item.promptText)).toEqual(['linked'])
  })

  it('does nothing with "Celebrate citations" off', () => {
    const { receive, shown } = setup({ enabled: false })
    receive(news())
    expect(shown).toEqual([])
  })

  it('in the background, waits and plays the first citation once on return', () => {
    const { receive, shown, state, resume } = setup()
    state.active = false
    receive(news({ promptText: 'first' }))
    receive(news({ promptText: 'second' }))
    resume()
    expect(shown).toEqual([])
    state.active = true
    resume()
    resume()
    expect(shown.map((item) => item.promptText)).toEqual(['first'])
    // Back in front, the same check stays quiet.
    receive(news({ promptText: 'third' }))
    expect(shown).toHaveLength(1)
  })

  it('keeps the first waiting check when several cite in the background', () => {
    const { receive, shown, state, resume } = setup()
    state.active = false
    receive(news({ promptText: 'a' }), 'job-1')
    receive(news({ promptText: 'b' }), 'job-2')
    state.active = true
    resume()
    expect(shown.map((item) => item.promptText)).toEqual(['a'])
  })

  it('drops what waited if the switch went off meanwhile', () => {
    const { receive, shown, state, resume } = setup()
    state.active = false
    receive(news())
    state.enabled = false
    state.active = true
    resume()
    expect(shown).toEqual([])
  })
})

describe('celebrationText', () => {
  it('names the brand, the engine, the link number and the question', () => {
    expect(celebrationText(news({ position: 1 }))).toEqual({
      headline: 'TextBolt was cited!',
      line: 'Google AI Overview linked your page as link #1',
      prompt: '“nagios email to sms replacement”'
    })
  })

  it('marks a first-ever citation and copes with missing parts', () => {
    expect(
      celebrationText(news({ firstEver: true, engine: null, position: null, promptText: '' }))
    ).toEqual({
      headline: "TextBolt's first citation!",
      line: 'An AI engine linked your page',
      prompt: ''
    })
    expect(celebrationText(news({ engine: 'perplexity' })).line).toBe(
      'Perplexity linked your page as link #2'
    )
  })
})
