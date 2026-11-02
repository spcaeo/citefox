// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltResults } from './fixtures'
import { countDelta, dropText, rateDelta, scoreDelta } from './deltas'
import { RunHeadline } from './headline'

afterEach(() => {
  cleanup()
})

describe('result deltas', () => {
  it('colours by sign and says No change at zero', () => {
    expect(scoreDelta(12, 26, 'Oct 5')).toEqual({
      text: '+12 since Oct 5 · +26 since baseline',
      className: 'm3-up'
    })
    expect(scoreDelta(-3, 4, 'Oct 5').className).toBe('m3-down')
    expect(scoreDelta(0, 0, 'Oct 5')).toEqual({
      text: 'No change since Oct 5',
      className: 'm3-flat'
    })
    expect(rateDelta(50, 50, 'Oct 5')).toEqual({
      text: 'No change since Oct 5 · 50%',
      className: 'm3-flat'
    })
    expect(rateDelta(38, 25, 'Oct 5')).toEqual({ text: '38% · was 25%', className: 'm3-up' })
    expect(rateDelta(20, 25, 'Oct 5').className).toBe('m3-down')
  })

  it('never says "since —" before a second check', () => {
    expect(scoreDelta(null, 0, '—')).toEqual({ text: 'No earlier check yet', className: 'm3-flat' })
    expect(countDelta(10, false, '—')).toEqual({
      text: 'No earlier check yet',
      className: 'm3-flat'
    })
    expect(countDelta(2, true, 'Oct 5')).toEqual({ text: '+2 since Oct 5', className: 'm3-up' })
    expect(countDelta(0, true, 'Oct 5').text).toBe('No change since Oct 5')
    expect(dropText(0, 'No AI Overview')).toBe('None lost here · No AI Overview')
    expect(dropText(3, 'No AI Overview')).toBe('−3 lost here · No AI Overview')
  })
})

describe('RunHeadline', () => {
  it('builds the summary sentence from the run counts', () => {
    const run = textboltResults().run
    if (!run) throw new Error('fixture run missing')
    const view = render(<RunHeadline run={run} brand="TextBolt" />)
    const text = view.container.textContent ?? ''
    expect(text).toContain(
      `Google showed an AI Overview for ${run.promptsWithAio} of ${run.promptsChecked} questions, citing this page in ${run.pageCited}, another TextBolt page in ${run.otherOwnPage}`
    )
    expect(text).toContain(`TextBolt was not in the other ${run.notCited}.`)
    expect(view.container.querySelectorAll('strong')).toHaveLength(5)
  })
})
