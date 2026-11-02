// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../ui/axe.test-helper'
import { EngineDots, EngineFilterBar, EngineFixed, EngineLegend, EngineStatus } from './EngineDots'
import { EngineLogos } from './EngineLogo'

afterEach(cleanup)

describe('EngineDots', () => {
  it('names every engine status and counts cited of answered', async () => {
    const view = render(
      <EngineDots
        engines={['google_aio', 'chatgpt', 'perplexity']}
        statuses={{ google_aio: 'cited', chatgpt: 'not_cited', perplexity: 'unavailable' }}
      />
    )
    const image = view.getByRole('img')
    expect(image.getAttribute('aria-label')).toBe(
      'Google AI Overview: Cited; ChatGPT: Not cited; Perplexity: Unavailable'
    )
    expect(view.container.querySelectorAll('.eng-dot-cited')).toHaveLength(1)
    expect(view.container.querySelectorAll('.eng-dot-not_cited')).toHaveLength(1)
    expect(view.container.querySelectorAll('.eng-dot-none')).toHaveLength(1)
    expect(view.getByText('1 of 2')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('shows a dash when no engine answered', () => {
    const view = render(<EngineDots engines={['google_aio', 'chatgpt']} statuses={undefined} />)
    expect(view.getByText('—')).toBeTruthy()
  })

  it('shows one status in words, unavailable in the calm grey', () => {
    const view = render(<EngineStatus status="unavailable" />)
    expect(view.getByText('Unavailable').className).toContain('faint')
  })

  it('draws the legend as the board does', () => {
    const view = render(<EngineLegend />)
    const items = view.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['Cited', 'Named, not cited', 'Not cited', 'No answer or unavailable'])
  })

  it('offers All and each engine, and reports the pick', () => {
    const onChange = vi.fn()
    const view = render(
      <EngineFilterBar engines={['google_aio', 'chatgpt']} value="all" onChange={onChange} />
    )
    expect(view.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: 'ChatGPT' }))
    expect(onChange).toHaveBeenCalledWith('chatgpt')
    // Logos alone, the engine's name as the button's name; no "Engine" label in front.
    expect(view.getByRole('button', { name: 'Google' })).toBeTruthy()
    expect(view.queryByText('Engine')).toBeNull()
  })

  it('shows each engine as its logo alone, named and with a tooltip, compact too', async () => {
    const view = render(
      <EngineFilterBar
        compact
        engines={['google_aio', 'chatgpt']}
        value="chatgpt"
        onChange={vi.fn()}
      />
    )
    const chatgpt = view.getByRole('button', { name: 'ChatGPT' })
    expect(chatgpt.getAttribute('aria-pressed')).toBe('true')
    expect(chatgpt.textContent).toBe('')
    expect(chatgpt.getAttribute('aria-label')).toBe('ChatGPT')
    expect(chatgpt.getAttribute('data-tip')).toBe('ChatGPT')
    expect(chatgpt.querySelector('img')).not.toBeNull()
    const all = view.getByRole('button', { name: 'All' })
    expect(all.querySelector('img')).toBeNull()
    expect(all.textContent).toBe('All')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('fixes one engine’s logo in the spot, named, and lists logos in a cell', () => {
    const view = render(
      <>
        <EngineFixed engine="google_aio" />
        <EngineFixed engine="chatgpt" />
        <EngineLogos engines={['google_aio', 'perplexity']} />
        <EngineLogos engines={undefined} />
      </>
    )
    expect(view.getByRole('img', { name: 'Google AI Overview only' }).textContent).toBe('')
    // The name is its tooltip too.
    expect(view.getByRole('img', { name: 'ChatGPT only' }).getAttribute('data-tip')).toBe(
      'ChatGPT only'
    )
    expect(view.queryByRole('button')).toBeNull()
    expect(view.getByRole('img', { name: 'Google AI Overview, Perplexity' })).toBeTruthy()
    expect(view.getByRole('img', { name: 'Google AI Overview' })).toBeTruthy()
  })
})
