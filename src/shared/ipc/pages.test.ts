import { describe, expect, test } from 'vitest'
import {
  createCiteFoxApi,
  isIpcEventChannel,
  isIpcInvokeChannel,
  type FillFromWebsiteProgress,
  type PageReadProgress,
  type PageReadResult
} from './index'

describe('IPC contract: page reads', () => {
  test('page-read progress is a push event and the result has no body or secret', () => {
    const progress: PageReadProgress = {
      pageId: 'alerts',
      phase: 'fetch',
      state: 'running',
      detail: 'Reading the page',
      nextStep: null
    }
    const fill: FillFromWebsiteProgress = {
      domain: 'textbolt.com',
      phase: 'suggest',
      state: 'ok',
      url: null,
      detail: 'Suggestions are ready',
      nextStep: null
    }
    const read: PageReadResult = {
      id: 'snap-1',
      pageId: 'alerts',
      fetchedAt: '2026-10-19T14:02:00.000Z',
      method: 'direct',
      httpStatus: 200,
      durationMs: 800,
      title: 'How to set up text alerts',
      titleLength: 28,
      metaDescription: 'A short description.',
      metaDescriptionLength: 20,
      h1: 'How to set up text alerts',
      titleMatchesH1: true,
      canonical: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      canonicalMatchesPage: true,
      publishedAt: '2026-09-03',
      modifiedAt: '2026-10-16',
      h2Count: 10,
      h3Count: 9,
      tableCount: 3,
      outline: [{ level: 'h2', text: 'Pricing', table: false }],
      faqs: [{ question: 'How much does it cost?', answer: 'Plans start at $29.', typo: null }],
      wordCount: 2140,
      contentHash: '7c21e9',
      snapshotReused: false,
      flags: [],
      eligibility: { issues: [] },
      summary: {
        promises: [{ title: 'No developer needed', detail: 'No code to install.' }],
        product: null
      },
      message: 'Page read. 200 OK. Direct fetch.',
      nextStep: null
    }
    expect(isIpcEventChannel('pages:readProgress')).toBe(true)
    expect(isIpcInvokeChannel('pages:readProgress')).toBe(false)
    expect(isIpcEventChannel('projects:fillProgress')).toBe(true)
    expect(isIpcInvokeChannel('pages:readStart')).toBe(true)
    const serialized = JSON.stringify({ progress, fill, read })
    expect(serialized).not.toMatch(
      /secret|password|api[_-]?key|token|suppliedText|bodyText|rawHtml/i
    )
    expect(Object.hasOwn(read, 'suppliedText')).toBe(false)
    expect(read.summary?.promises[0]?.title).toBe('No developer needed')
  })

  test('subscribes to page-read progress and forwards one argument to pages:readStart', () => {
    const seen: string[] = []
    const progress: PageReadProgress = {
      pageId: 'alerts',
      phase: 'extract',
      state: 'ok',
      detail: 'Title, headings, and FAQs extracted',
      nextStep: null
    }
    const api = createCiteFoxApi(
      async (channel) => {
        seen.push(channel)
        return null
      },
      (channel, listener) => {
        seen.push(channel)
        listener(progress)
        return () => undefined
      }
    )
    const received: PageReadProgress[] = []
    api['pages:readProgress']((payload) => {
      received.push(payload)
    })
    expect(received).toEqual([progress])
    void api['pages:readStart']({
      projectId: 'textbolt',
      pageId: 'alerts',
      reader: 'jina',
      suppliedText: null
    })
    expect(seen).toEqual(['pages:readProgress', 'pages:readStart'])
  })
})
