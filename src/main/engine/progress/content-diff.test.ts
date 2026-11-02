import { describe, expect, test } from 'vitest'
import type { StoredSnapshot } from '../../storage/snapshot-records'
import { bodyLines, diffLines, diffSnapshots, MAX_DIFF_LINES } from './content-diff'

describe('line diff', () => {
  test('keeps order and marks added and removed lines', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { op: 'same', text: 'a' },
      { op: 'removed', text: 'b' },
      { op: 'added', text: 'x' },
      { op: 'same', text: 'c' },
      { op: 'added', text: 'd' }
    ])
    expect(diffLines([], [])).toEqual([])
    expect(diffLines(['a'], [])).toEqual([{ op: 'removed', text: 'a' }])
  })

  test('long unchanged heads and tails stay cheap', () => {
    const head = Array.from({ length: 5000 }, (_, index) => `line ${index}`)
    const result = diffLines([...head, 'old'], [...head, 'new'])
    expect(result).toHaveLength(5002)
    expect(result.slice(-2)).toEqual([
      { op: 'removed', text: 'old' },
      { op: 'added', text: 'new' }
    ])
  })
})

describe('body lines', () => {
  test('splits paragraphs and sentences and drops blank lines', () => {
    expect(bodyLines('First one. Second one?\n\n  Third!  \nFourth')).toEqual([
      'First one.',
      'Second one?',
      'Third!',
      'Fourth'
    ])
  })
})

describe('snapshot diff (FR-15.1 Compare content)', () => {
  test('reports title, meta, H1, outline, FAQ and body changes in plain words', () => {
    const before = snapshot('snap-1', {
      title: 'Text alerts',
      metaDescription: null,
      h1: 'Text alerts for business',
      outline: [
        { level: 'h2', text: 'Why alerts', table: false },
        { level: 'h3', text: 'Email to text', table: false }
      ],
      faqs: [{ question: 'Is it free?', answer: 'No.', typo: null }],
      bodyText: 'TextBolt sends alerts. No developer required.',
      wordCount: 6
    })
    const after = snapshot('snap-2', {
      title: 'Text alerts for business',
      metaDescription: 'Send alerts from email.',
      h1: 'Text alerts for business',
      outline: [
        { level: 'h2', text: 'Why alerts', table: false },
        { level: 'h2', text: 'Scheduling', table: false }
      ],
      faqs: [
        { question: 'Is it free?', answer: 'No.', typo: null },
        { question: 'Does it work with Gmail?', answer: 'Yes.', typo: null }
      ],
      bodyText: 'TextBolt sends alerts. Schedule them from Gmail. No developer required.',
      wordCount: 10
    })
    const diff = diffSnapshots('page-1', before, after)
    expect(diff.from).toEqual({
      id: 'snap-1',
      fetchedAt: before.fetchedAt,
      wordCount: 6,
      faqCount: 1
    })
    expect(diff.to.faqCount).toBe(2)
    expect(diff.summary).toBe('1 FAQ added, 4 words added.')
    expect(diff.fields).toEqual([
      {
        field: 'title',
        label: 'Title',
        before: 'Text alerts',
        after: 'Text alerts for business',
        changed: true
      },
      {
        field: 'meta_description',
        label: 'Meta description',
        before: null,
        after: 'Send alerts from email.',
        changed: true
      },
      {
        field: 'h1',
        label: 'H1',
        before: 'Text alerts for business',
        after: 'Text alerts for business',
        changed: false
      }
    ])
    expect(diff.outline).toEqual([
      { op: 'same', text: 'H2 Why alerts' },
      { op: 'removed', text: '  H3 Email to text' },
      { op: 'added', text: 'H2 Scheduling' }
    ])
    expect(diff.faqs).toEqual([
      { op: 'same', text: 'Q: Is it free?' },
      { op: 'same', text: 'A: No.' },
      { op: 'added', text: 'Q: Does it work with Gmail?' },
      { op: 'added', text: 'A: Yes.' }
    ])
    expect(diff.body).toEqual([
      { op: 'same', text: 'TextBolt sends alerts.' },
      { op: 'added', text: 'Schedule them from Gmail.' },
      { op: 'same', text: 'No developer required.' }
    ])
    expect(diff.bodyTruncated).toBe(false)
  })

  test('a very long body is cut and says so', () => {
    const long = Array.from({ length: MAX_DIFF_LINES + 50 }, (_, index) => `Sentence ${index}.`)
    const diff = diffSnapshots(
      'page-1',
      snapshot('a', { bodyText: long.join(' ') }),
      snapshot('b', { bodyText: [...long].reverse().join(' ') })
    )
    expect(diff.bodyTruncated).toBe(true)
    expect(diff.body.length).toBeLessThanOrEqual(MAX_DIFF_LINES * 2)
  })
})

function snapshot(id: string, overrides: Partial<StoredSnapshot>): StoredSnapshot {
  return {
    id,
    pageId: 'page-1',
    fetchedAt:
      id === 'snap-1' || id === 'a' ? '2026-10-05T12:00:00.000Z' : '2026-10-16T12:00:00.000Z',
    method: 'direct',
    httpStatus: 200,
    durationMs: 1,
    title: null,
    metaDescription: null,
    h1: null,
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: 'Body.',
    wordCount: 1,
    contentHash: 'a'.repeat(64),
    summary: null,
    ...overrides
  }
}
