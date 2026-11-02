// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import { DrillHost } from '../../drill'
import { axeViolations } from '../../ui/axe.test-helper'
import type { KeyActions } from '../hooks/useKeyActions'
import { KeyTable } from './KeyTable'

afterEach(cleanup)

function actions(): KeyActions {
  return {
    busy: false,
    message: null,
    say: vi.fn(),
    test: vi.fn(async () => undefined),
    toggle: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    replace: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    run: vi.fn(async () => true)
  }
}

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k1',
    provider: 'serpapi',
    name: 'Agency plan',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    ...patch
  }
}

describe('Connections key table: the status explains itself', () => {
  test('"Near cap" sits beside CiteFox’s 20 and the account’s 218,102 of 250,000', async () => {
    const view = render(
      <DrillHost>
        <KeyTable
          keys={[
            key({
              cap: 250_000,
              usedThisMonth: 20,
              serpapiUsage: { used: 218_102, planLimit: 250_000, plan: 'Big Data' },
              statusDetail: 'Near cap'
            })
          ]}
          title="SerpApi"
          caption="SerpApi keys in rotation order"
          actions={actions()}
          projects={[]}
          detailed
        />
      </DrillHost>
    )
    const grid = view.getByRole('grid', { name: 'SerpApi keys in rotation order' })
    const row = within(grid).getAllByRole('row')[1] as HTMLElement
    expect(row.textContent).toContain('20 of 250,000')
    expect(row.textContent).toContain('Account 218,102 of 250,000')
    const status = within(row).getByRole('button', { name: /status: Near cap/ })
    expect(status.getAttribute('title')).toBe(
      'Account near its plan: 218,102 of 250,000 searches used, other tools included.'
    )
    expect(status.getAttribute('aria-label')).toBe(
      'Agency plan status: Near cap. Account near its plan: 218,102 of 250,000 searches used, other tools included. Show details'
    )
    expect(await axeViolations(view.container)).toEqual([])
  })

  test('a cloro row shows CiteFox’s use and the credits left, without a searches bar', () => {
    const view = render(
      <DrillHost>
        <KeyTable
          keys={[
            key({
              provider: 'cloro',
              name: 'cloro',
              usedThisMonth: 12,
              cloroCredits: { remaining: 1_230, perCycle: 37_500, resetsAt: null }
            })
          ]}
          title="cloro"
          caption="cloro keys in rotation order"
          actions={actions()}
          projects={[]}
          detailed
        />
      </DrillHost>
    )
    const row = within(view.getByRole('grid')).getAllByRole('row')[1] as HTMLElement
    expect(row.textContent).toContain('12 by CiteFox')
    expect(row.textContent).toContain('Account 1,230 of 37,500 credits left')
    expect(
      within(row).getByRole('button', { name: /12 by CiteFox on cloro this month/ })
    ).toBeTruthy()
    expect(row.querySelector('.bar')).toBeNull()
    expect(
      within(row).getByRole('button', { name: /cloro status: Works\. Account balance/ })
    ).toBeTruthy()
  })
})
