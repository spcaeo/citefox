import { describe, expect, test } from 'vitest'
import { mergeImproveLines, type ImproveLine } from './mergeImprove'

const add = (text: string, detail: string | null = null): ImproveLine => ({
  text,
  detail,
  sign: 'add'
})
const remove = (text: string): ImproveLine => ({ text, detail: null, sign: 'remove' })

describe('mergeImproveLines', () => {
  test('an added line with no anchor goes at the end, before the trailing newline', () => {
    expect(mergeImproveLines('a\nb\n', [add('c')])).toBe('a\nb\nc\n')
    expect(mergeImproveLines('a\nb', [add('c')])).toBe('a\nb\nc')
  })

  test('an added line goes after the line its detail names', () => {
    const body = 'Step 1\nStep 2\nStep 3'
    expect(mergeImproveLines(body, [add('Step 1b', 'After: Step 1')])).toBe(
      'Step 1\nStep 1b\nStep 2\nStep 3'
    )
    expect(mergeImproveLines(body, [add('Step 2b', 'Step 2')])).toBe(
      'Step 1\nStep 2\nStep 2b\nStep 3'
    )
  })

  test('several lines after one anchor keep their order', () => {
    const merged = mergeImproveLines('Intro line here\nOutro', [
      add('First', 'After: Intro line here'),
      add('Second', 'After: Intro line here')
    ])
    expect(merged).toBe('Intro line here\nFirst\nSecond\nOutro')
  })

  test('a detail that quotes a line in a sentence still finds it', () => {
    const merged = mergeImproveLines('Write the questions in full sentences.\nEnd', [
      add('Keep each under 30 words.', 'Goes after "Write the questions in full sentences."')
    ])
    expect(merged).toBe('Write the questions in full sentences.\nKeep each under 30 words.\nEnd')
  })

  test('a removed line is deleted by exact match, ignoring spaces and a bullet', () => {
    const body = 'Keep\n- Write them short and lowercase.\nKeep too'
    expect(mergeImproveLines(body, [remove('Write them short and lowercase.')])).toBe(
      'Keep\nKeep too'
    )
    expect(mergeImproveLines(body, [remove('Write them short')])).toBe(body)
  })

  test('a line already in the draft is not added twice', () => {
    expect(mergeImproveLines('a\nb', [add('b'), add('  a  ')])).toBe('a\nb')
  })

  test('adds and removes together, as Apply all sends them', () => {
    const merged = mergeImproveLines('Write exactly 10 prompts.\nNever name a brand.\n', [
      add('Cover every segment in the buyer profile.'),
      remove('Write exactly 10 prompts.')
    ])
    expect(merged).toBe('Never name a brand.\nCover every segment in the buyer profile.\n')
  })
})

describe('mergeImproveLines with the template.improve reply shape', () => {
  test('adds after the line a detail says it starts with, removes exact lines, appends the rest', () => {
    const body = [
      'Write {{ prompt_count }} prompts.',
      '- Write it in full sentences, about 15 to 30 words.',
      '- Never include the brand name or an alias.',
      'Reply with JSON that matches the schema and no other text.',
      ''
    ].join('\n')
    const merged = mergeImproveLines(body, [
      add(
        '- Count the words before you reply.',
        'Add after the line that starts "- Write it in full sentences". Two runs were short.'
      ),
      add(
        '- Check every prompt for the brand names.',
        'Add after the line that starts "- Never include the brand name". One run named it.'
      ),
      remove('Reply with JSON that matches the schema and no other text.'),
      add('Reply with JSON only.', 'Add at the end, in place of the removed line.')
    ])
    expect(merged).toBe(
      [
        'Write {{ prompt_count }} prompts.',
        '- Write it in full sentences, about 15 to 30 words.',
        '- Count the words before you reply.',
        '- Never include the brand name or an alias.',
        '- Check every prompt for the brand names.',
        'Reply with JSON only.',
        ''
      ].join('\n')
    )
  })
})
