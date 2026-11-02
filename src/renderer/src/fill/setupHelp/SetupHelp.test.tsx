// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockShellClient } from '../../projects/mockClient'
import { NewProjectForm } from '../../projects/NewProjectForm'
import { axeViolations } from '../../ui/axe.test-helper'
import { fakeSetupSource, type FakeSetupSource } from './fixtures.test-helper'

/**
 * New project → "How should we set up …?" (HelpFill.dc.html panel 4): the three
 * ways, the chatbot prompt for the typed site, the pasted answer in the found
 * cards, the Fill card and the questions plan, and the ticked questions created
 * as topics only after Create project.
 */

beforeEach(() => {
  window.location.hash = '#/new-project'
  try {
    window.localStorage.clear()
  } catch {
    // No storage in this environment: the remembered bot is not used.
  }
})
afterEach(cleanup)

function renderForm(source: FakeSetupSource): ReturnType<typeof render> {
  return render(
    <NewProjectForm
      client={createMockShellClient()}
      heading="h1"
      setupSource={source}
      onCreated={async () => undefined}
    />
  )
}

function typeSite(): void {
  fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'TextBolt' } })
  fireEvent.change(screen.getByLabelText(/Website domain/), {
    target: { value: 'https://TextBolt.com/pricing' }
  })
  fireEvent.change(screen.getByLabelText('Brand names'), { target: { value: 'TextBolt' } })
}

const radio = (name: RegExp): HTMLInputElement =>
  screen.getByRole('radio', { name }) as HTMLInputElement

describe('New project setup helper', () => {
  it('offers three ways; with CiteFox AI set up it opens on Read my website with its cost', async () => {
    const view = renderForm(fakeSetupSource())
    expect(screen.getByRole('heading', { name: 'How should we set up your site?' })).toBeTruthy()
    await screen.findByText('Up to 5 AI calls · about $0.05')
    expect(radio(/Read my website/u).checked).toBe(true)
    expect(radio(/Use my own ChatGPT/u).checked).toBe(false)
    expect(radio(/I’ll fill it in/u).checked).toBe(false)
    const read = screen.getByRole('button', { name: 'Read my website' }) as HTMLButtonElement
    expect(read.disabled).toBe(true)
    typeSite()
    expect(screen.getByRole('heading', { name: 'How should we set up textbolt.com?' })).toBeTruthy()
    expect(read.disabled).toBe(false)
    // One green primary: Create project.
    expect(view.container.querySelectorAll('.ui-btn-primary')).toHaveLength(1)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('the chatbot way: the prompt for the typed site, the answer in the found cards and the Fill card', async () => {
    const source = fakeSetupSource()
    renderForm(source)
    await screen.findByText('Up to 5 AI calls · about $0.05')
    fireEvent.click(radio(/Use my own ChatGPT/u))
    expect(window.location.hash).toContain('help=chatbot')
    expect((await screen.findByTestId('su-no-domain')).textContent).toContain(
      'Enter your website’s domain'
    )
    typeSite()
    await waitFor(() =>
      expect(screen.getByTestId('hf-prompt').textContent).toContain(
        'AI-search tracking for textbolt.com'
      )
    )
    expect(source.prompts.at(-1)).toEqual({ domain: 'textbolt.com', brandNames: ['TextBolt'] })

    fireEvent.change(screen.getByLabelText('Paste its answer below'), {
      target: { value: '### PRODUCTS\nname,url,job\nEmail to SMS,/email-to-text/,Texts' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))
    const summary = await screen.findByTestId('su-summary')
    expect(summary.textContent).toContain('Read your answer.')
    expect(summary.textContent).toContain(
      '1 repeat was merged. 1 named TextBolt and was set aside.'
    )
    const count = (id: string): string =>
      within(screen.getByTestId(`su-found-${id}`)).getByText(/^\d+$/u).textContent ?? ''
    expect(count('products')).toBe('2')
    expect(count('buyers')).toBe('2')
    expect(count('competitors')).toBe('3')
    expect(count('markets')).toBe('2')
    expect(screen.getByTestId('su-found-markets').textContent).toContain('Markets: US, CA')
    expect(count('questions')).toBe('3')
    expect(count('topics')).toBe('3')
    // The same Fill card "Read my website" fills, saying where its suggestions came from.
    const card = screen.getByRole('region', { name: 'Suggestions from the website' })
    expect(card.textContent).toContain('from your chatbot’s answer')
    // A count card opens its tab on the Fill card.
    fireEvent.click(screen.getByTestId('su-found-buyers'))
    expect(window.location.hash).toContain('fill=buyers')
  })

  it('creates the ticked questions as topics only after Create project', async () => {
    const source = fakeSetupSource()
    renderForm(source)
    await screen.findByText('Up to 5 AI calls · about $0.05')
    fireEvent.click(radio(/Use my own ChatGPT/u))
    typeSite()
    await screen.findByText(/AI-search tracking for textbolt\.com/u)
    fireEvent.change(screen.getByLabelText('Paste its answer below'), { target: { value: 'x\ny' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))
    const plan = await screen.findByTestId('su-plan')
    expect(source.topics).toEqual([])
    fireEvent.click(
      within(plan).getByRole('checkbox', {
        name: 'How do I text the night shift when an alarm emails?'
      })
    )
    expect(within(plan).getByText(/2 ticked in 3 topics/u)).toBeTruthy()
    expect(screen.getByText('Review the suggestions and 2 questions, then create.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(window.location.hash).toBe('#/start/choose'))
    expect(source.topics).toHaveLength(1)
    expect(source.topics[0]?.topics.map((topic) => topic.name)).toEqual(['Email to SMS', 'General'])
  })

  it('with no CiteFox AI key: Read my website says so, and the helper opens on the chatbot way', async () => {
    window.location.hash = '#/new-project?help=website'
    renderForm(fakeSetupSource({ available: false }))
    await screen.findByText(/Needs CiteFox AI connected\. Use your own ChatGPT instead \(free\)\./u)
    expect(radio(/Read my website/u).disabled).toBe(true)
    await waitFor(() => expect(window.location.hash).toContain('help=chatbot'))
    expect(radio(/Use my own ChatGPT/u).checked).toBe(true)
  })

  it('I’ll fill it in shows only the form', async () => {
    renderForm(fakeSetupSource())
    await screen.findByText('Up to 5 AI calls · about $0.05')
    fireEvent.click(radio(/I’ll fill it in/u))
    expect(window.location.hash).toContain('help=form')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Read my website' })).toBeNull()
    )
    expect(screen.queryByTestId('hf-chatbot')).toBeNull()
  })
})
