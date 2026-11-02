import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { expect } from 'vitest'
import type { TopicDraft, TopicWizardPath } from '@shared/domain'
import type { TopicDraftPatch } from '@shared/ipc'
import { TopicWizard } from '.'
import type { TopicsClient, WizardChannel } from './client'
import { createMockTopicsClient, MOCK_DRAFTS_STORAGE_KEY } from './mock/mockTopics'
import type { WizardProject } from './types'

export const PROJECT: WizardProject = {
  id: 'p1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  markets: [
    { id: 'us', label: 'US · EN' },
    { id: 'ca', label: 'CA · EN' }
  ]
}

export interface Call {
  channel: WizardChannel
  request: unknown
}

/** The TextBolt mock with every channel call recorded. */
export function recordingClient(): {
  client: TopicsClient
  calls: Call[]
  count: (channel: WizardChannel) => number
} {
  const mock = createMockTopicsClient()
  const calls: Call[] = []
  const client = Object.fromEntries(
    Object.entries(mock).map(([channel, method]) => [
      channel,
      async (request: unknown) => {
        calls.push({ channel: channel as WizardChannel, request })
        return (method as (value: unknown) => Promise<unknown>)(request)
      }
    ])
  ) as unknown as TopicsClient
  return {
    client,
    calls,
    count: (channel) => calls.filter((call) => call.channel === channel).length
  }
}

export function resetMockStore(): void {
  localStorage.removeItem(MOCK_DRAFTS_STORAGE_KEY)
  localStorage.removeItem('citefox.mock.pace')
  window.location.hash = ''
}

/**
 * A saved draft on `path`, filled by `fill` through the same channels the
 * screens use, then patched (`step` and anything else).
 */
export async function savedDraft(
  client: TopicsClient,
  path: TopicWizardPath,
  fill: (draftId: string) => Promise<void> = async () => undefined,
  patch: TopicDraftPatch = {}
): Promise<TopicDraft> {
  const created = await client['topics:createDraft']({
    projectId: PROJECT.id,
    path,
    seed: 'Text alerts for teams without a developer'
  })
  await client['topics:updateDraft']({
    projectId: PROJECT.id,
    draftId: created.id,
    patch: { marketIds: ['us'] }
  })
  await fill(created.id)
  return client['topics:updateDraft']({ projectId: PROJECT.id, draftId: created.id, patch })
}

export function openWizard(client: TopicsClient, draftId: string | null): RenderResult {
  return render(<TopicWizard project={PROJECT} draftId={draftId} client={client} />)
}

export async function heading(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name })
}

/** Opens a menu button and picks a line. */
export function pickMenu(trigger: string | RegExp, item: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: trigger }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: item }))
}

export async function lastRequest(
  calls: Call[],
  channel: WizardChannel
): Promise<Record<string, unknown>> {
  await waitFor(() => expect(calls.some((call) => call.channel === channel)).toBe(true))
  const found = [...calls].reverse().find((call) => call.channel === channel)
  return found?.request as Record<string, unknown>
}

export function footerPrimary(): HTMLElement {
  const footer = document.querySelector('.ui-wizard-foot') as HTMLElement
  const buttons = within(footer).getAllByRole('button')
  return buttons[buttons.length - 1] as HTMLElement
}
