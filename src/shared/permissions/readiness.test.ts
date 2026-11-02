import { describe, expect, it } from 'vitest'
import type { PermissionItem, StatusCapsule } from '../ipc'
import { readiness, readinessText } from './readiness'

function item(
  id: PermissionItem['id'],
  need: PermissionItem['need'],
  state: PermissionItem['state']
): PermissionItem {
  return {
    id,
    title: id,
    purpose: '',
    need,
    state,
    statusLabel: state,
    detail: null,
    checks: [],
    osPrompt: null,
    action: null
  }
}

const QUIET: Pick<StatusCapsule, 'serpapi' | 'claudeCode' | 'jina' | 'youtube'> = {
  serpapi: 'ok',
  claudeCode: 'unchecked',
  jina: 'off',
  youtube: 'off'
}

describe('readiness: one count for the capsule, the popover, Status and the checklist', () => {
  it('counts required checklist items that are not ready as steps left', () => {
    const items = [
      item('claude', 'required', 'unchecked'),
      item('serpapi', 'required', 'ok'),
      item('keychain', 'required', 'action'),
      item('notifications', 'optional', 'off')
    ]
    const ready = readiness({ items }, QUIET)
    expect(ready.steps).toBe(2)
    expect(ready.issues).toBe(0)
    expect(readinessText(ready)).toBe('2 required steps left')
    expect(readinessText(ready, { short: true })).toBe('2 steps left')
  })

  it('adds a connection warning once, not again when its checklist item is already a step', () => {
    const items = [item('claude', 'required', 'action'), item('serpapi', 'required', 'ok')]
    const ready = readiness({ items }, { ...QUIET, claudeCode: 'warning', jina: 'warning' })
    expect(ready.steps).toBe(1)
    expect(ready.issues).toBe(1)
    expect(ready.items.map((entry) => entry.id)).toEqual(['claude', 'jina'])
    expect(readinessText(ready)).toBe('1 required step left · 1 issue')
  })

  it('says 0 issues only when every required item is ready', () => {
    const items = [item('claude', 'required', 'ok'), item('serpapi', 'required', 'ok')]
    expect(readinessText(readiness({ items }, QUIET))).toBe('0 issues')
    // Before the checklist loads, only connection warnings count.
    expect(readinessText(readiness(null, { ...QUIET, serpapi: 'warning' }))).toBe('1 issue')
  })
})
