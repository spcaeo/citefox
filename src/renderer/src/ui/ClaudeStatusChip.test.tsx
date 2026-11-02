// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeStatus } from '@shared/ipc'
import { axeViolations } from './axe.test-helper'
import { claudeCapsuleText, claudeChipModel } from './claudeChip'
import { ClaudeStatusChip, ClaudeStatusLine } from './ClaudeStatusChip'

afterEach(cleanup)

const READY: ClaudeStatus = {
  connection: 'claude-code',
  state: 'ready',
  name: 'Claude Code',
  summary: 'connected',
  plan: 'Claude Max',
  model: 'Sonnet 4.5',
  checkedAt: '2026-10-22T12:00:00.000Z',
  fresh: true,
  nextStep: null
}

const MISSING: ClaudeStatus = {
  ...READY,
  state: 'needs_setup',
  summary: 'not found',
  plan: null,
  nextStep: 'Install Claude Code.'
}

describe('Claude status chip', () => {
  it('names the connection, plan and model when ready', () => {
    expect(claudeChipModel(READY, false, true)).toEqual({
      tone: 'ok',
      parts: ['Claude Code', 'connected', 'Claude Max', 'Sonnet 4.5'],
      label: 'Claude connection: Claude Code, connected, Claude Max, Sonnet 4.5'
    })
    expect(claudeChipModel(MISSING, false, true).tone).toBe('warn')
    expect(claudeChipModel(READY, true, true).parts).toEqual(['Claude Code', 'checking…'])
    expect(claudeChipModel(null, false, true).parts).toEqual(['Claude', 'reading status…'])
  })

  it('says CiteFox AI and the state only, outside Status', () => {
    expect(claudeChipModel(READY, false)).toEqual({
      tone: 'ok',
      parts: ['CiteFox AI', 'connected'],
      label: 'CiteFox AI: connected'
    })
    expect(claudeChipModel(MISSING, false).parts).toEqual(['CiteFox AI', 'needs a step'])
    expect(claudeChipModel(READY, true).parts).toEqual(['CiteFox AI', 'checking…'])
  })

  it('the capsule says it in two words', () => {
    expect(claudeCapsuleText(READY, false)).toBe('CiteFox AI connected')
    expect(claudeCapsuleText(MISSING, false)).toBe('CiteFox AI needs a step')
    expect(claudeCapsuleText({ ...READY, state: 'unchecked' }, false)).toBe(
      'CiteFox AI not checked'
    )
    expect(claudeCapsuleText(null, true)).toBe('Checking CiteFox AI…')
    expect(claudeCapsuleText(null, false)).toBeNull()
  })

  it('offers Set up when Claude needs a step, and is accessible', async () => {
    const view = render(
      <p>
        <ClaudeStatusChip status={MISSING} setupHref="#/permissions" named />
      </p>
    )
    expect(view.getByRole('link', { name: 'Set up' }).getAttribute('href')).toBe('#/permissions')
    expect(view.getByText('Claude connection: Claude Code, not found')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('renders nothing outside a permissions provider', () => {
    const view = render(<ClaudeStatusLine />)
    expect(view.container.innerHTML).toBe('')
  })
})
