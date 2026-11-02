// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { TabPanel, Tabs } from './Tabs'

afterEach(cleanup)

type Id = 'todo' | 'stage' | 'keywords' | 'progress'

const TABS = [
  { id: 'todo', label: 'To-do', count: 17 },
  { id: 'stage', label: 'By stage', count: 6 },
  { id: 'keywords', label: 'Keywords', count: 118 },
  { id: 'progress', label: 'Progress', count: '4 checks' }
] as const

function Harness({ start = 'todo' }: { start?: Id }): JSX.Element {
  const [tab, setTab] = useState<Id>(start)
  return (
    <>
      <Tabs label="Topic sections" tabs={TABS} value={tab} onChange={setTab} panelId="topic" />
      <TabPanel panelId="topic" id={tab}>
        Panel {tab}
      </TabPanel>
    </>
  )
}

function tabs(): HTMLElement[] {
  return within(document.body).getAllByRole('tab')
}

describe('Tabs', () => {
  it('shows counts after labels and one tab stop on the selected tab', () => {
    const view = render(<Harness />)
    const list = view.getByRole('tablist', { name: 'Topic sections' })
    expect(within(list).getAllByRole('tab')).toHaveLength(4)
    expect(tabs()[0]?.textContent).toBe('To-do17')
    expect(tabs()[0]?.querySelector('.ui-tab-count')?.textContent).toBe('17')
    // The label carries its own text for the width-holding semibold copy.
    expect(tabs()[0]?.querySelector('.ui-tab-label')?.getAttribute('data-label')).toBe('To-do')
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true')
    const panel = view.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0]?.id)
    expect(tabs()[0]?.getAttribute('aria-controls')).toBe(panel.id)
  })

  it('moves and selects with arrows, Home and End, wrapping at the ends', () => {
    render(<Harness />)
    const first = tabs()[0]
    if (!first) throw new Error('no tabs')
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(tabs()[3]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[3])
    fireEvent.keyDown(tabs()[3] as HTMLElement, { key: 'ArrowRight' })
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs()[0] as HTMLElement, { key: 'End' })
    expect(document.activeElement?.textContent).toContain('Progress')
    fireEvent.keyDown(tabs()[3] as HTMLElement, { key: 'Home' })
    expect(document.activeElement?.textContent).toContain('To-do')
    expect(within(document.body).getByRole('tabpanel').textContent).toBe('Panel todo')
  })

  it('selects on click', () => {
    const view = render(<Harness />)
    fireEvent.click(view.getByRole('tab', { name: /Keywords/ }))
    expect(view.getByRole('tab', { name: /Keywords/ }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tabpanel').textContent).toBe('Panel keywords')
  })

  it('is axe clean', async () => {
    const view = render(<Harness start="stage" />)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('draws sub-tabs as the lighter sm strip', () => {
    const view = render(
      <Tabs label="Results views" tabs={TABS} value="todo" onChange={() => {}} size="sm" />
    )
    const list = view.getByRole('tablist', { name: 'Results views' })
    expect(list.className).toBe('ui-tabs ui-tabs-sm')
    cleanup()
    const page = render(
      <Tabs label="Topic sections" tabs={TABS} value="todo" onChange={() => {}} className="x" />
    )
    expect(page.getByRole('tablist').className).toBe('ui-tabs x')
  })

  it('renders tabs with an href as links that keep the tab roles', async () => {
    const picked: string[] = []
    const linked = TABS.map((tab) => ({ ...tab, href: `#/topics/t1?view=${tab.id}` }))
    const view = render(
      <>
        <Tabs
          label="Topic sections"
          tabs={linked}
          value="stage"
          onChange={(id) => picked.push(id)}
          panelId="topic"
        />
        <TabPanel panelId="topic" id="stage">
          Panel stage
        </TabPanel>
      </>
    )
    const stage = view.getByRole('tab', { name: /By stage/ })
    expect(stage.tagName).toBe('A')
    expect(stage.getAttribute('href')).toBe('#/topics/t1?view=stage')
    expect(stage.getAttribute('aria-current')).toBe('page')
    expect(stage.getAttribute('aria-controls')).toBe('topic-stage')
    expect(stage.tabIndex).toBe(0)
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(picked).toEqual(['keywords'])
    expect(document.activeElement?.textContent).toContain('Keywords')
    fireEvent.click(view.getByRole('tab', { name: /Progress/ }))
    expect(picked).toEqual(['keywords', 'progress'])
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('draws a lead mark before the label, hidden from screen readers', () => {
    const view = render(
      <Tabs
        label="Engines"
        tabs={[
          { id: 'a', label: 'ChatGPT', lead: <span data-testid="dot" /> },
          { id: 'b', label: 'Gemini' }
        ]}
        value="a"
        onChange={() => undefined}
      />
    )
    const lead = view.getByTestId('dot').parentElement
    expect(lead?.getAttribute('aria-hidden')).toBe('true')
    expect(view.getByRole('tab', { name: 'ChatGPT' })).toBeTruthy()
  })
})
