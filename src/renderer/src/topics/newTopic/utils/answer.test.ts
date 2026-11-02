import { describe, expect, it } from 'vitest'
import type { TopicPageCandidate } from '@shared/ipc'
import { answerPlan, promptWithProblem, targetFor } from './answer'

const SITE = 'https://textbolt.com'
const CANDIDATES: TopicPageCandidate[] = [
  {
    pageId: 'p-pricing',
    url: `${SITE}/pricing/`,
    title: 'Pricing',
    source: 'tracked',
    outline: []
  },
  { pageId: null, url: `${SITE}/blog/`, title: null, source: 'sitemap', outline: [] }
]

describe('New topic: a chatbot answer as the plan', () => {
  it('takes the name most rows give, and each question with its stage and page', () => {
    const plan = answerPlan([
      { id: 'a', section: null, values: { question: 'Q one?', stage: 'problem', topic: 'Alerts' } },
      { id: 'b', section: null, values: { question: 'Q two?', stage: 'nope', topic: 'Other' } },
      { id: 'c', section: null, values: { question: ' Q three? ', page: '/x/', topic: 'Alerts' } },
      { id: 'd', section: null, values: { question: '  ' } }
    ])
    expect(plan.name).toBe('Alerts')
    expect(plan.questions).toEqual([
      { text: 'Q one?', stage: 'problem', page: '' },
      { text: 'Q two?', stage: null, page: '' },
      { text: 'Q three?', stage: null, page: '/x/' }
    ])
  })

  it('points a page at a tracked page by path, else a new page on the site, else nothing', () => {
    expect(targetFor('/pricing', CANDIDATES)).toEqual({
      pageId: 'p-pricing',
      url: `${SITE}/pricing/`
    })
    expect(targetFor(`${SITE}/PRICING/?ref=x`, CANDIDATES)).toEqual({
      pageId: 'p-pricing',
      url: `${SITE}/pricing/`
    })
    expect(targetFor('/guides/cost/', CANDIDATES)).toEqual({
      pageId: null,
      url: `${SITE}/guides/cost/`
    })
    expect(targetFor('https://other.io/a', CANDIDATES)).toEqual({
      pageId: null,
      url: 'https://other.io/a'
    })
    expect(targetFor('', CANDIDATES)).toBeNull()
    expect(targetFor('the pricing page', CANDIDATES)).toBeNull()
    expect(targetFor('/new/', [])).toBeNull()
  })

  it('adds the typed problem before the tracked list, without emails, keys or file paths', () => {
    const prompt = 'Role.\nBusiness: x.\nAlready tracked: no questions yet.\n\nTask.'
    expect(promptWithProblem(prompt, '  ')).toBe(prompt)
    expect(
      promptWithProblem(
        prompt,
        'Clinics losing texts, mail me at a.b@clinic.org, key sk-ant-abcdefghijklmnop12, see /Users/me/notes.txt'
      )
    ).toBe(
      'Role.\nBusiness: x.\nBuyer problem: Clinics losing texts, mail me at , key , see\nAlready tracked: no questions yet.\n\nTask.'
    )
  })
})
