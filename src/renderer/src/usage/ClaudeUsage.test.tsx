// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { LlmUsage, LlmUsageRequest } from '@shared/ipc'
import type { UsageClient } from './client'
import { createMockUsageClient } from './client'
import { ClaudeUsage } from './ClaudeUsage'
import { formatTokens, stepLabel, usageSummary } from './model'
import { mockLlmUsage } from './mock'

afterEach(() => {
  cleanup()
})

function clientOf(usage: (request: LlmUsageRequest) => Promise<LlmUsage>): {
  client: UsageClient
  requests: LlmUsageRequest[]
} {
  const requests: LlmUsageRequest[] = []
  return {
    requests,
    client: {
      usage: (request) => {
        requests.push(request)
        return usage(request)
      }
    }
  }
}

const EMPTY: LlmUsage = {
  builtAt: '2026-10-19T14:00:00.000Z',
  callsToday: 0,
  failedToday: 0,
  callsThisMonth: 0,
  tokensInThisMonth: 0,
  tokensOutThisMonth: 0,
  byConnection: [],
  byStep: [],
  recent: [],
  recentErrors: []
}

describe('usage model', () => {
  it('formats tokens compactly', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(41_200)).toBe('41.2k')
    expect(formatTokens(2000)).toBe('2k')
    expect(formatTokens(1_284_000)).toBe('1.3M')
  })

  it('names template kinds and assist ids in plain words', () => {
    expect(stepLabel('buyer_profile')).toBe('Buyer profile')
    expect(stepLabel('results.explainChange')).toBe('Explain this change')
    expect(stepLabel('other')).toBe('Other')
    expect(stepLabel('brand_prompts')).toBe('Brand questions')
    expect(stepLabel('someone.unknown')).toBe('someone.unknown')
  })
})

describe('ClaudeUsage', () => {
  it('shows the summary line, connections, steps and recent errors', async () => {
    const { client, requests } = clientOf(mockLlmUsage)
    const view = render(<ClaudeUsage client={client} />)
    const card = within(view.getByRole('region', { name: 'Calls and tokens' }))
    await waitFor(() => {
      expect(
        card.getByText('CiteFox AI calls today 31 · tokens this month 1.3M in / 196.4k out')
      ).toBeTruthy()
    })
    expect(requests).toEqual([{}])
    expect(card.getByText(/1 failed today/)).toBeTruthy()
    expect(card.getByText('CiteFox AI on this computer')).toBeTruthy()
    expect(card.getByText('Anthropic API key')).toBeTruthy()
    expect(card.getByText('377 calls · 1M in / 158.2k out')).toBeTruthy()
    fireEvent.click(card.getByText('By step (6)'))
    expect(card.getByText('Buyer questions')).toBeTruthy()
    expect(card.getByText('Explain this change')).toBeTruthy()
    expect(card.getByText('52 calls · 1 failed · about 12 s')).toBeTruthy()
    expect(
      card.getByText('CiteFox AI hit its usage limit. Try again after it resets.')
    ).toBeTruthy()
    expect(card.getAllByText('Write more like this')).toHaveLength(2)
  })

  it('the full layout shows KPI tiles and list grids under tabs', async () => {
    const { client } = clientOf(mockLlmUsage)
    const view = render(<ClaudeUsage client={client} variant="full" />)
    const card = within(view.getByRole('region', { name: 'Calls and tokens' }))
    const today = await card.findByRole('region', { name: 'Calls today' })
    expect(today.textContent).toContain('31')
    expect(today.textContent).toContain('1 failed today')
    expect(card.getByRole('region', { name: 'Tokens out · month' }).textContent).toContain('196.4k')
    const steps = card.getByRole('grid', { name: 'CiteFox AI calls by step this month' })
    expect(within(steps).getByText('Buyer questions')).toBeTruthy()
    fireEvent.click(card.getByRole('tab', { name: /^Recent errors/ }))
    const errors = card.getByRole('grid', { name: 'Recent CiteFox AI errors' })
    expect(
      within(errors).getByText('CiteFox AI hit its usage limit. Try again after it resets.')
    ).toBeTruthy()
    fireEvent.click(card.getByRole('tab', { name: /^By connection/ }))
    expect(card.getByText('Anthropic API key')).toBeTruthy()
  })

  it('reads one project when given a project id', async () => {
    const { client, requests } = clientOf(mockLlmUsage)
    render(<ClaudeUsage client={client} projectId="textbolt" />)
    await waitFor(() => {
      expect(requests).toEqual([{ projectId: 'textbolt' }])
    })
  })

  it('reads again when the refresh key changes', async () => {
    const { client, requests } = clientOf(mockLlmUsage)
    const view = render(<ClaudeUsage client={client} refreshKey="a" />)
    await waitFor(() => expect(requests).toHaveLength(1))
    view.rerender(<ClaudeUsage client={client} refreshKey="b" />)
    await waitFor(() => expect(requests).toHaveLength(2))
  })

  it('says so when there are no calls and no errors', async () => {
    const { client } = clientOf(async () => EMPTY)
    const view = render(<ClaudeUsage client={client} />)
    await waitFor(() => {
      expect(
        view.getByText('CiteFox AI calls today 0 · tokens this month 0 in / 0 out')
      ).toBeTruthy()
    })
    expect(view.getByText('No CiteFox AI calls this month yet.')).toBeTruthy()
    expect(view.getByText('No errors')).toBeTruthy()
    expect(view.queryByText(/failed today/)).toBeNull()
  })

  it('shows a read failure without the Electron wrapper', async () => {
    const { client } = clientOf(async () => {
      throw new Error("Error invoking remote method 'llm:usage': Error: llm:usage: Disk is full")
    })
    const view = render(<ClaudeUsage client={client} />)
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toBe('Could not read CiteFox AI usage. Disk is full')
  })

  it('loads the mock through the lazy client', async () => {
    const view = render(<ClaudeUsage client={createMockUsageClient()} />)
    const usage = await mockLlmUsage({})
    expect(await view.findByText(usageSummary(usage))).toBeTruthy()
  })
})
