import { describe, expect, it } from 'vitest'
import {
  GENERATION_TEMPLATE_KINDS,
  isListedTemplateStep,
  TOPIC_TEMPLATE_KINDS
} from '@shared/domain'
import { areaPositions, stepArea } from './stepCopy'

describe('step areas', () => {
  it('puts topic kinds under Topics, the check summary under Reports, the rest under Pages', () => {
    for (const kind of TOPIC_TEMPLATE_KINDS) expect(stepArea(kind)).toBe('topics')
    expect(stepArea('run_summary')).toBe('reports')
    expect(stepArea('assistant_explain')).toBe('assistant')
    expect(stepArea('buyer_profile')).toBe('pages')
    expect(stepArea('video_brief')).toBe('pages')
    expect(stepArea('some_new_kind')).toBe('pages')
  })

  it('numbers steps from 1 inside each area, in run order', () => {
    // The listed steps, as the screen gets them: planned kinds are hidden.
    const listed = GENERATION_TEMPLATE_KINDS.filter((kind) => isListedTemplateStep(kind, false))
    const steps = listed.map((kind, index) => ({ kind, position: index + 1 }))
    const numbers = areaPositions([...steps].reverse())
    expect(numbers.get('buyer_profile')).toBe(1)
    // Content gaps run as three steps (matrix, audit, fixes) since P1.
    // Sentiment runs as two steps (claims, fact check) since P6.
    expect(numbers.get('video_brief')).toBe(11)
    expect(numbers.get('run_summary')).toBe(1)
    expect(numbers.get('topic_seed_discover')).toBe(1)
    const topics = TOPIC_TEMPLATE_KINDS.filter((kind) => isListedTemplateStep(kind, false))
    expect(numbers.get(topics.at(-1) ?? '')).toBe(topics.length)
  })
})
