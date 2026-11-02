// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeCell } from './ChangeCell'
import { ResultChip } from './ResultChip'
import { resultOfCheck } from './resultTones'

afterEach(cleanup)

describe('ResultChip', () => {
  it('draws every result in one colour map, with no dot', () => {
    const view = render(
      <>
        <ResultChip result="cited" position={2} />
        <ResultChip result="named" />
        <ResultChip result="own_page" />
        <ResultChip result="not_cited" />
        <ResultChip result="failed" />
      </>
    )
    expect(view.getByText('Cited #2').className).toContain('ui-chip-ok')
    expect(view.getByText('Named').className).toContain('ui-result-named')
    expect(view.getByText('Your other page').className).toContain('ui-chip-info')
    expect(view.getByText('Not cited').className).toContain('ui-result-not-cited')
    expect(view.getByText('Check failed').className).toContain('ui-chip-bad')
    expect(view.container.querySelector('.ui-dot')).toBeNull()
    for (const chip of view.container.querySelectorAll('.ui-chip')) {
      expect(chip.className).toContain('ui-chip-sm')
    }
  })

  it('shows no overview and not checked as faint text, not a pill', () => {
    const view = render(
      <>
        <ResultChip result="no_overview" />
        <ResultChip result="not_checked" label="Not checked yet" />
      </>
    )
    expect(view.getByText('No AI Overview').className).toContain('faint')
    expect(view.getByText('Not checked yet').className).not.toContain('ui-chip')
  })

  it('keeps a screen’s own words but the shared colour', () => {
    const view = render(<ResultChip result={resultOfCheck('page_cited')} label="Page cited" />)
    expect(view.getByText('Page cited').className).toContain('ui-chip-ok')
    expect(resultOfCheck('brand_mentioned')).toBe('named')
    expect(resultOfCheck('other_own_page')).toBe('own_page')
    expect(resultOfCheck('no_aio')).toBe('no_overview')
    expect(resultOfCheck('error')).toBe('failed')
  })
})

describe('ChangeCell', () => {
  it('writes a change as coloured text and no change as a faint dash', () => {
    const view = render(
      <>
        <ChangeCell label="Gained" tone="good" />
        <ChangeCell label={null} tone="neutral" />
        <ChangeCell delta={11} unit="pts" />
        <ChangeCell delta={-3} unit="pts" />
        <ChangeCell delta={0} />
        <ChangeCell delta={2} upIsBad />
      </>
    )
    expect(view.getByText('Gained').className).toBe('ui-change ui-change-good')
    expect(view.getByText('+11 pts').className).toContain('ui-change-good')
    expect(view.getByText('−3 pts').className).toContain('ui-change-bad')
    expect(view.getByText('+2').className).toContain('ui-change-bad')
    const dashes = view.getAllByText('—')
    expect(dashes).toHaveLength(2)
    for (const dash of dashes) expect(dash.className).toContain('faint')
    expect(view.container.querySelector('.ui-chip')).toBeNull()
    expect(view.queryByText('+0')).toBeNull()
  })
})
