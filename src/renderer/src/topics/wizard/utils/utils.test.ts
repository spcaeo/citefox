import { describe, expect, it } from 'vitest'
import type { TopicDraft } from '@shared/domain'
import { newDraft, perStageFor, questionTarget, stepProblem } from './draft'
import { fitFor, keywordEstimate, rangeText, searchRange, startLabel } from './estimate'
import { cleanUp, csvColumns, csvLines, guessStage, parseCsv, parsePasted } from './importParse'
import { applyPatch, mergePatch, promptInput } from './patch'
import { currentStep, nextStep, previousStep, stepsFor } from './steps'
import { namesAny } from './text'

let n = 0
const makeId = (prefix: string): string => `${prefix}-${++n}`
const NOW = '2026-10-21T10:00:00.000Z'

function draft(overrides: Partial<TopicDraft> = {}): TopicDraft {
  return {
    ...newDraft({
      id: 'd1',
      projectId: 'p1',
      path: 'seed',
      now: NOW,
      website: 'textbolt.com',
      brandNames: ['TextBolt', 'Text Bolt'],
      competitors: ['simpletexting.com'],
      marketIds: ['us'],
      seed: 'Text alerts for teams without a developer'
    }),
    ...overrides
  }
}

describe('steps', () => {
  it('skips Keywords when the seed path writes buyer questions only', () => {
    expect(stepsFor(draft({ generate: 'questions' })).map((s) => s.id)).toEqual([
      'seed',
      'profile',
      'questions',
      'pages',
      'estimate'
    ])
    expect(stepsFor(draft({ generate: 'both' })).map((s) => s.id)).toContain('keywords')
  })

  it('skips the profile and questions when it writes keywords only', () => {
    expect(stepsFor(draft({ generate: 'keywords' })).map((s) => s.id)).toEqual([
      'seed',
      'keywords',
      'pages',
      'estimate'
    ])
  })

  it('gives each path its own steps and moves along them', () => {
    expect(stepsFor(draft({ path: 'questions' })).map((s) => s.id)).toEqual([
      'import',
      'cleanup',
      'pages',
      'estimate'
    ])
    expect(stepsFor(draft({ path: 'competitor' })).map((s) => s.id)).toEqual([
      'competitor',
      'questions',
      'pages',
      'estimate'
    ])
    const d = draft({ generate: 'questions' })
    expect(nextStep(d, 'questions')).toBe('pages')
    expect(previousStep(d, 'pages')).toBe('questions')
    expect(previousStep(d, 'seed')).toBeNull()
    expect(currentStep({ ...d, step: 'keywords' })).toBe('seed')
  })
})

describe('draft rules', () => {
  it('asks for a problem, a name and a market before the seed step goes on', () => {
    expect(stepProblem(draft({ seed: '' }), 'seed')).toMatch(/problem/)
    expect(stepProblem(draft({ name: ' ' }), 'seed')).toMatch(/name/)
    expect(stepProblem(draft({ marketIds: [] }), 'seed')).toMatch(/market/)
    expect(stepProblem(draft(), 'seed')).toBeNull()
  })

  it('needs a read page on the competitor path and a kept question elsewhere', () => {
    expect(stepProblem(draft({ path: 'competitor', competitorUrl: 'nope' }), 'competitor')).toMatch(
      /https/
    )
    expect(
      stepProblem(draft({ path: 'competitor', competitorUrl: 'https://x.com/a/' }), 'competitor')
    ).toMatch(/Read their page/)
    expect(stepProblem(draft(), 'questions')).toMatch(/at least one question/)
  })

  it('counts Custom per stage and caps it at 100', () => {
    expect(questionTarget({ preset: 'deep', perStage: perStageFor(60) })).toBe(60)
    expect(
      questionTarget({
        preset: 'custom',
        perStage: { ...perStageFor(0), fit: 30, decide: 30, doubts: 30, options: 30 }
      })
    ).toBe(100)
    expect(Object.values(perStageFor(15))).toEqual([3, 3, 3, 2, 2, 2])
  })
})

describe('patches', () => {
  it('applies scalars, depth and question upserts the way main does', () => {
    const next = applyPatch(
      draft(),
      {
        name: 'Alerts',
        questionDepth: { preset: 'quick', perStage: perStageFor(15) },
        upsertPrompts: [{ kind: 'question', text: 'Can TextBolt text my staff?', stage: 'fit' }]
      },
      { now: NOW, makeId }
    )
    expect(next.name).toBe('Alerts')
    expect(next.depth.questions.preset).toBe('quick')
    expect(next.prompts).toHaveLength(1)
    expect(next.prompts[0]).toMatchObject({
      source: 'user',
      stage: 'fit',
      flags: ['brand'],
      matchStatus: 'unmatched'
    })
  })

  it('edits keep the old wording for Undo and removals run before upserts', () => {
    const base = applyPatch(
      draft(),
      { upsertPrompts: [{ id: 'q1', kind: 'question', text: 'One' }] },
      { now: NOW, makeId }
    )
    const prompt = base.prompts[0]!
    const edited = applyPatch(
      base,
      { upsertPrompts: [promptInput(prompt, { text: 'Two' })] },
      { now: NOW, makeId }
    )
    expect(edited.prompts[0]).toMatchObject({ text: 'Two', previousText: 'One' })
    const removed = applyPatch(edited, { removePromptIds: ['q1'] }, { now: NOW, makeId })
    expect(removed.prompts).toHaveLength(0)
  })

  it('saves a profile patch as a new version and switches back with profileVersion', () => {
    const v1 = applyPatch(
      draft(),
      { profile: { points: [{ section: 'who', text: 'Office managers' }], note: 'edited' } },
      { now: NOW, makeId }
    )
    const v2 = applyPatch(
      v1,
      {
        profile: {
          points: [
            { section: 'who', text: 'Office managers' },
            { section: 'triggers', text: 'A missed alert' }
          ],
          note: 'filled_gaps'
        }
      },
      { now: NOW, makeId }
    )
    expect(v2.profile?.current).toBe(2)
    expect(v2.profile?.versions[1]?.points.map((p) => p.isNew)).toEqual([false, true])
    expect(applyPatch(v2, { profileVersion: 1 }, { now: NOW, makeId }).profile?.current).toBe(1)
  })

  it('merges queued patches: later scalars win, same-id upserts merge, removals add up', () => {
    const merged = mergePatch(
      {
        name: 'A',
        upsertPrompts: [
          { id: 'q1', kind: 'question', text: 'x' },
          { id: 'q2', kind: 'question', text: 'y' }
        ]
      },
      {
        name: 'B',
        upsertPrompts: [{ id: 'q1', kind: 'question', text: 'x2', included: false }],
        removePromptIds: ['q2']
      }
    )
    expect(merged.name).toBe('B')
    expect(merged.upsertPrompts).toEqual([
      { id: 'q1', kind: 'question', text: 'x2', included: false }
    ])
    expect(merged.removePromptIds).toEqual(['q2'])
  })
})

describe('estimate', () => {
  it('counts 1–2 searches per question and market and says whether it fits', () => {
    expect(searchRange(28, 1)).toEqual({ low: 28, high: 56 })
    expect(rangeText(28, 56)).toBe('28–56')
    expect(fitFor({ low: 6, high: 12 }, 13)).toBe('fits')
    expect(fitFor({ low: 10, high: 20 }, 13)).toBe('may_not_fit')
    expect(fitFor({ low: 28, high: 56 }, 13)).toBe('over_budget')
    expect(fitFor({ low: 1, high: 2 }, null)).toBe('unknown')
  })

  it('keeps the keyword estimate inside the max and labels Start by plan', () => {
    const quick = keywordEstimate(
      {
        preset: 'quick',
        maxKeywords: 30,
        synonymsPerCoreTerm: 1,
        patternVariants: ['a', 'b'],
        longTailQuestions: false,
        intentFamilies: ['pricing'],
        perGroupCap: 5
      },
      3
    )
    expect(quick.high).toBeLessThanOrEqual(30)
    const plan = {
      plan: 'likeliest' as const,
      label: '',
      detail: '',
      todayPrompts: 6,
      todaySearchesLo: 6,
      todaySearchesHi: 12,
      restDays: 7,
      fit: 'fits' as const,
      suggested: true,
      firstStage: null,
      firstGroup: null
    }
    expect(startLabel(plan, null)).toBe('Start: 6 likeliest today')
    expect(startLabel({ ...plan, plan: 'stage_first', firstStage: 'problem' }, 'Problem')).toBe(
      'Start: check Problem'
    )
    expect(startLabel({ ...plan, plan: 'all_now', todayPrompts: 28 }, null)).toBe(
      'Start: check all 28'
    )
  })
})

describe('import parsing', () => {
  it('reads pasted lines and RFC 4180 CSV', () => {
    expect(parsePasted('- one\n\n2) two\n“three”')).toEqual(['one', 'two', 'three'])
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\nz,w')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['z', 'w']
    ])
  })

  it('guesses the columns from the header and maps rows', () => {
    const content = 'notes,question,channel\nn1,How do I text staff?,Support\n,Can it reply?,'
    const columns = csvColumns(content)
    expect(columns.guess).toEqual({ question: 1, source: 2, notes: 0, hasHeader: true })
    expect(columns.rows).toBe(2)
    expect(csvLines(content, columns.guess)).toEqual([
      { text: 'How do I text staff?', source: 'Support' },
      { text: 'Can it reply?', source: 'CSV' }
    ])
  })

  it('merges duplicates, flags brand (left out) and short lines (kept)', () => {
    const result = cleanUp(
      [
        { text: 'Do we need 10DLC to text our own staff?', source: 'Support' },
        { text: 'do we need 10dlc to text our own staff', source: 'Sales call' },
        { text: 'Is TextBolt cheaper than SimpleTexting?', source: 'Web form' },
        { text: 'sms alerts', source: 'Web form' }
      ],
      ['TextBolt'],
      () => makeId('q')
    )
    expect(result.duplicatesMerged).toBe(1)
    expect(result.brandFlagged).toBe(1)
    expect(result.shortFlagged).toBe(1)
    const [first, brand, short] = result.prompts
    expect(first?.flags).toContain('merged')
    expect(brand).toMatchObject({ included: false, flags: ['brand'] })
    expect(short).toMatchObject({ included: true, flags: ['short'] })
    expect(guessStage('How much does it cost?')).toBe('decide')
    expect(namesAny('Text Bolt rocks', ['Text Bolt'])).toBe(true)
    expect(namesAny('textbolted', ['TextBolt'])).toBe(false)
  })
})
