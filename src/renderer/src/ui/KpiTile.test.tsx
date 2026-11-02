// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DrillHost } from '../drill/DrillHost'
import { DrillNumber } from '../drill/DrillNumber'
import { resultsDrill, resultsScope } from '../drill/fromResults'
import { drillCount } from '../drill/types'
import { TEXTBOLT_MARKETS, TEXTBOLT_PAGE_ID, textboltResults } from '../m3/fixtures'
import { axeViolations } from './axe.test-helper'
import { Chip } from './Chip'
import { KpiStrip, KpiTile } from './KpiTile'

afterEach(cleanup)

const results = textboltResults()
const scope = resultsScope(results, {
  pageId: TEXTBOLT_PAGE_ID,
  market: TEXTBOLT_MARKETS[0],
  runId: 'run-9'
})
const aio = resultsDrill(results, 'kpi:aio', scope)

describe('KpiTile', () => {
  it('shows label, big number, suffix, goal bar, trend and sub line', () => {
    const view = render(
      <KpiTile
        label="Buyer questions cited"
        value="42%"
        goal={{ value: 42, band: { lo: 50, hi: 70 } }}
        trend={{ direction: 'up', text: '+3 since Sep 28' }}
        sub="11 of 26 · goal 50–70%"
      />
    )
    const tile = view.getByRole('region', { name: 'Buyer questions cited' })
    expect(within(tile).getByText('42%').className).toContain('ui-kpi-value')
    expect(within(tile).getByRole('meter', { name: '42% cited, target 50–70%' })).toBeTruthy()
    expect(tile.querySelector('.ui-goal-ticks')).toBeNull()
    expect(within(tile).getByText('+3 since Sep 28').className).toContain('ui-kpi-trend-ok')
    expect(within(tile).getByText('11 of 26 · goal 50–70%')).toBeTruthy()
  })

  it('colours a trend by its tone and shows a chip and suffix', () => {
    const view = render(
      <KpiTile
        label="AI Overview shown"
        value="26"
        suffix="/ 28"
        trend={{ direction: 'down', text: '−2', tone: 'neutral' }}
        chip={<Chip tone="ok">In band</Chip>}
      />
    )
    expect(view.getByText('/ 28').className).toBe('ui-kpi-suffix')
    expect(view.getByText('−2').className).toContain('ui-kpi-trend-neutral')
    expect(view.getByText('In band')).toBeTruthy()
  })

  it('takes a DrillNumber as its value and opens the drawer of what it counts', async () => {
    if (!aio) throw new Error('missing fixture drill')
    const view = render(
      <DrillHost>
        <KpiTile label="AI Overview shown" value={<DrillNumber drill={aio} />} suffix="/ 28" />
      </DrillHost>
    )
    const number = view.getByRole('button', { name: new RegExp(aio.title) })
    expect(number.closest('.ui-kpi-value')).toBeTruthy()
    expect(number.textContent).toBe(String(drillCount(aio)))
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(number)
    expect(view.getByRole('dialog')).toBeTruthy()
  })

  it('puts the trend beside the label and the goal bar in the number row', () => {
    const view = render(
      <KpiTile
        label="Buyer questions cited"
        value="42%"
        goal={{ value: 42 }}
        trend={{ direction: 'up', text: '+3 since Sep 28' }}
      />
    )
    const head = view.container.querySelector('.ui-kpi-head')
    expect(head?.querySelector('.ui-kpi-label')?.textContent).toBe('Buyer questions cited')
    expect(head?.querySelector('.ui-kpi-trend')?.textContent).toBe('+3 since Sep 28')
    const row = view.container.querySelector('.ui-kpi-row')
    expect(row?.querySelector('.ui-kpi-goal [role="meter"]')).toBeTruthy()
  })

  it('keeps the sub line to one line with the whole visible text as its title', () => {
    const view = render(
      <KpiTile
        label="Visibility score"
        value="67"
        sub={
          <>
            2 scored questions · No change since Oct 5
            <span className="sr-only"> How the score is built.</span>
          </>
        }
      />
    )
    const sub = view.container.querySelector('.ui-kpi-sub')
    expect(sub?.getAttribute('title')).toBe('2 scored questions · No change since Oct 5')
    expect(view.getByText('Visibility score').getAttribute('title')).toBe('Visibility score')
  })

  it('reserves the sub line when there is none, so every tile is one height', () => {
    const view = render(<KpiTile label="Checks" value="2" />)
    const sub = view.container.querySelector('.ui-kpi-sub')
    expect(sub?.classList.contains('ui-kpi-sub-empty')).toBe(true)
    expect(sub?.getAttribute('aria-hidden')).toBe('true')
    expect(sub?.textContent).toBe('')
    expect(sub?.hasAttribute('title')).toBe(false)
  })

  it('is axe clean', async () => {
    const view = render(
      <KpiTile
        label="To reach the band"
        value="+2"
        suffix="cited questions"
        sub="11 now · 13 needed"
      />
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})

describe('KpiStrip', () => {
  it('holds a row of tiles as one region, or a plain group without a label', async () => {
    const view = render(
      <KpiStrip label="Headline numbers" className="m3-kpis">
        <KpiTile label="Visibility score" value="67" suffix="/ 100" />
        <KpiTile label="This page cited" value="1" suffix="of 2 AI Overviews" />
      </KpiStrip>
    )
    const strip = view.getByRole('region', { name: 'Headline numbers' })
    expect(strip.className).toBe('ui-kpis m3-kpis')
    expect(within(strip).getAllByRole('region')).toHaveLength(2)
    expect(await axeViolations(view.container)).toEqual([])
    cleanup()
    const plain = render(
      <KpiStrip>
        <KpiTile label="Checks" value="2" />
      </KpiStrip>
    )
    expect(plain.container.firstElementChild?.tagName).toBe('DIV')
    expect(plain.container.firstElementChild?.className).toBe('ui-kpis')
  })

  it('lays out one column per tile, or the columns asked for', () => {
    const view = render(
      <KpiStrip label="Numbers">
        <KpiTile label="A" value="1" />
        <KpiTile label="B" value="2" />
      </KpiStrip>
    )
    const strip = view.getByRole('region', { name: 'Numbers' })
    expect(strip.hasAttribute('data-cols')).toBe(false)
    expect(strip.style.getPropertyValue('--kpi-cols')).toBe('')
    cleanup()
    const two = render(
      <KpiStrip label="Numbers" columns={2}>
        <KpiTile label="A" value="1" />
        <KpiTile label="B" value="2" />
        <KpiTile label="C" value="3" />
        <KpiTile label="D" value="4" />
      </KpiStrip>
    )
    const block = two.getByRole('region', { name: 'Numbers' })
    expect(block.hasAttribute('data-cols')).toBe(true)
    expect(block.style.getPropertyValue('--kpi-cols')).toBe('2')
  })
})
