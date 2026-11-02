import { describe, expect, test } from 'vitest'
import { parseSiteRead, parseSwitching } from './assist'
import {
  PRODUCT_COMPETITORS_SHAPE,
  SITE_READ_SHAPE,
  SWITCHING_SHAPE,
  renderAssistShape,
  type AssistShape
} from './assist-shapes'
import { parseProductCompetitors } from './product-competitors'

/** The example as Claude sees it: rendered, then parsed back from the prompt text. */
function roundTrip(shape: AssistShape): unknown {
  const line = renderAssistShape(shape).split('\n')[1] ?? ''
  return JSON.parse(line) as unknown
}

describe('assist reply shapes', () => {
  test('each rendered example is accepted by its parser', () => {
    expect(parseSiteRead(roundTrip(SITE_READ_SHAPE))?.products).toHaveLength(1)
    expect(parseSwitching(roundTrip(SWITCHING_SHAPE))).not.toBeNull()
    const competitors = parseProductCompetitors(roundTrip(PRODUCT_COMPETITORS_SHAPE))
    expect(competitors?.direct[0]?.sources).toHaveLength(2)
    expect(competitors?.partial).toHaveLength(1)
  })

  test('the rendered text tells Claude to reply with JSON only', () => {
    const text = renderAssistShape(SITE_READ_SHAPE)
    expect(text.startsWith('Reply with JSON only, in this shape:\n')).toBe(true)
    expect(text).toContain('"suggestedMarket"')
    expect(text).toContain(SITE_READ_SHAPE.notes)
  })
})
