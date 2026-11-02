import { describe, expect, test } from 'vitest'
import type { SqliteDatabase } from '../storage/database'
import { clusterThemes } from './themes'

interface Row {
  page_id: string
  prompt_id: string
  position: number
  label: string
  text: string | null
}

/** A database stub that answers the one prompt query with these rows. */
function db(rows: readonly Row[]): SqliteDatabase & { args: unknown[] } {
  const args: unknown[] = []
  return {
    args,
    prepare: () => ({
      all: (...values: unknown[]) => {
        args.push(...values)
        return rows
      }
    })
  } as unknown as SqliteDatabase & { args: unknown[] }
}

const PAGES = [
  { id: 'p-1', title: 'Text alerts', url: 'https://textbolt.com/blog/text-alerts/' },
  { id: 'p-2', title: null, url: 'https://textbolt.com/blog/email-to-sms/' }
]

describe('clusterThemes', () => {
  test('lists the prompts behind each theme, by label, variant text or theme words', () => {
    const stub = db([
      { page_id: 'p-1', prompt_id: 'a', position: 1, label: 'Send texts from email', text: null },
      { page_id: 'p-1', prompt_id: 'b', position: 2, label: 'SMS pricing', text: 'sms cost' },
      { page_id: 'p-2', prompt_id: 'c', position: 1, label: 'Email to text', text: null },
      {
        page_id: 'p-2',
        prompt_id: 'c',
        position: 1,
        label: 'Email to text',
        text: 'how do I send texts from email'
      },
      { page_id: 'p-2', prompt_id: 'd', position: 2, label: 'Pricing', text: null }
    ])
    const themes = clusterThemes(stub, ['send texts from email', 'pricing'], PAGES)
    expect(stub.args).toEqual([JSON.stringify(['p-1', 'p-2'])])
    expect(themes[0]?.prompts.map((prompt) => prompt.promptId)).toEqual(['a', 'c'])
    expect(themes[0]?.prompts[1]).toEqual({
      pageId: 'p-2',
      promptId: 'c',
      position: 1,
      label: 'Email to text',
      pageLabel: '/blog/email-to-sms/'
    })
    expect(themes[1]?.prompts.map((prompt) => prompt.promptId)).toEqual(['b', 'd'])
  })

  test('no themes or no pages need no query', () => {
    expect(clusterThemes(db([]), [], PAGES)).toEqual([])
    expect(clusterThemes(db([]), ['pricing'], [])).toEqual([{ theme: 'pricing', prompts: [] }])
  })
})
