// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within, type RenderResult } from '@testing-library/react'
import type { SetupDraft } from '@shared/ipc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsHost, resetAppInfoCache } from '../buildMenu'
import { SetupChrome } from './SetupChrome'
import { emptySetupDraft } from './setupDraft'
import type { SetupProgress, SetupView } from './setupSteps'
import { StepPage } from './StepPage'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
})

const BUILD_CLIENT = {
  getInfo: () =>
    Promise.resolve({
      name: 'CiteFox',
      version: '1.2.3',
      build: { commit: 'abc1234', builtAt: new Date(2026, 9, 22, 19, 50).toISOString() }
    }),
  resetKeepKeys: () => Promise.resolve({ ok: true as const }),
  openTestProfile: () => Promise.resolve({ ok: true as const, alreadyOpen: false })
}

const PROGRESS: SetupProgress = { profileSaved: false, searchReady: false }

function readDraft(): SetupDraft {
  const draft = emptySetupDraft()
  return {
    ...draft,
    site: { ...draft.site, domain: 'textbolt.com', country: 'US', language: 'en' },
    readDone: true
  }
}

const updateSettings = vi.fn().mockResolvedValue(undefined)

function renderChrome(
  view: SetupView,
  draft: SetupDraft = readDraft(),
  onStep: (step: string) => void = vi.fn()
): RenderResult {
  return render(
    <BuildToolsHost client={BUILD_CLIENT}>
      <SetupChrome
        view={view}
        draft={draft}
        progress={PROGRESS}
        announcement=""
        announcementLog={[]}
        onWelcome={() => undefined}
        onStep={onStep}
        client={{ updateSettings }}
      >
        <p>Body</p>
      </SetupChrome>
    </BuildToolsHost>
  )
}

describe('SetupChrome', () => {
  it('has the Light, Dark and System switch in its top bar, on every step', async () => {
    const picks = [
      ['welcome', 'Dark', 'dark'],
      ['site', 'Light', 'light']
    ] as const
    for (const [view, label, theme] of picks) {
      const { getByRole, findByRole, unmount } = renderChrome(view)
      fireEvent.click(getByRole('button', { name: 'Theme' }))
      fireEvent.click(await findByRole('menuitemradio', { name: `Theme: ${label}` }))
      expect(updateSettings).toHaveBeenLastCalledWith({ theme })
      unmount()
    }
  })

  it('shows the 9-step stepper with done steps as buttons back to that step', async () => {
    const onStep = vi.fn()
    const view = renderChrome('brand', readDraft(), onStep)
    const nav = view.getByRole('navigation', { name: 'Setup steps' })
    const labels = within(nav)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.ui-step-label')?.textContent)
    expect(labels).toEqual([
      'Site',
      'AI',
      'Read',
      'Brand',
      'Buyers',
      'Rivals',
      'Engines',
      'Ask',
      'Questions'
    ])
    const current = within(nav).getByText('Brand').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    fireEvent.click(within(nav).getByRole('button', { name: /Site/ }))
    expect(onStep).toHaveBeenCalledWith('site')
    expect(within(nav).getByRole('button', { name: /Read/ }).textContent).toContain('(done)')
    expect(within(nav).queryByRole('button', { name: /Buyers/ })).toBeNull()
    expect(view.getByText('Source-available · © Space-O Technologies')).toBeTruthy()
    const chip = await within(view.getByRole('banner')).findByRole('button', { name: /v1\.2\.3/ })
    expect(chip.textContent).toContain('v1.2.3 · 22 Oct · abc1234')
  })

  it('marks an earlier step that lost what it needs as not done', () => {
    const draft = { ...readDraft(), readDone: false }
    const view = renderChrome('brand', draft)
    const nav = view.getByRole('navigation', { name: 'Setup steps' })
    expect(within(nav).getByRole('button', { name: /Read/ }).textContent).toContain('(not done)')
  })

  it('hides the stepper on the welcome screen', () => {
    const view = renderChrome('welcome')
    expect(view.queryByRole('navigation', { name: 'Setup steps' })).toBeNull()
  })
})

describe('StepPage', () => {
  it('runs the same handler from the footer primary and from Enter in a field', () => {
    const onSubmit = vi.fn()
    const onBack = vi.fn()
    const view = render(
      <StepPage
        title="Connect SerpApi"
        onSubmit={onSubmit}
        onBack={onBack}
        note="Each prompt uses 1–2 searches per check"
        primary={{ label: 'Continue', onClick: onSubmit }}
        rail={<p>Rail</p>}
        railLabel="About SerpApi"
      >
        <label htmlFor="f">Field</label>
        <input id="f" />
      </StepPage>
    )
    expect(view.getByRole('heading', { level: 1, name: 'Connect SerpApi' })).toBeTruthy()
    expect(view.getByRole('complementary', { name: 'About SerpApi' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.submit(view.getByLabelText('Field'))
    expect(onSubmit).toHaveBeenCalledTimes(2)
    fireEvent.click(view.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(view.getByRole('status').textContent).toContain('1–2 searches')
  })
})
