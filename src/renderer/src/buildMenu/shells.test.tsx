// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsMenu } from '../shell/SettingsMenu'
import { TopBar } from '../shell/TopBar'
import { StartFrame } from '../start/StartFrame'
import { resetAppInfoCache } from './appInfoStore'
import { useBuildTools, type BuildClient } from './buildClient'
import { BuildToolsHost } from './BuildToolsHost'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
})

const CLIENT: BuildClient = {
  getInfo: () =>
    Promise.resolve({
      name: 'CiteFox',
      version: '0.11.0',
      build: { commit: null, number: 900, builtAt: '2026-10-22T23:50:00.000Z' }
    }),
  resetKeepKeys: () => Promise.resolve({ ok: true }),
  openTestProfile: () => Promise.resolve({ ok: true, alreadyOpen: false })
}

describe('the version in every top bar', () => {
  it('sits in the main shell top bar ⚙ menu, after Ask', async () => {
    const view = render(
      <BuildToolsHost client={CLIENT}>
        <TopBar
          crumbs={[{ label: 'All pages' }]}
          status={<button type="button">Status</button>}
          onAsk={() => undefined}
          askOpen={false}
          settings={
            <SettingsMenu
              searches="210 searches left"
              setup={null}
              onOpenStatus={() => undefined}
            />
          }
        />
      </BuildToolsHost>
    )
    const banner = view.getByRole('banner')
    // No build chip in the bar itself any more.
    expect(within(banner).queryByRole('button', { name: /v0\.11\.0/ })).toBeNull()
    const gear = within(banner).getByRole('button', { name: 'Settings menu' })
    const buttons = within(banner).getAllByRole('button')
    expect(buttons.indexOf(gear)).toBe(buttons.length - 1)
    expect(buttons.indexOf(within(banner).getByRole('button', { name: 'Ask CiteFox' }))).toBe(
      buttons.length - 2
    )
    fireEvent.click(gear)
    const menu = view.getByRole('menu', { name: 'Settings menu' })
    expect(
      await within(menu).findByRole('menuitem', {
        name: /^v0\.11\.0 · build 900 · Oct 22, 2026 7:50 PM EDT: copy build info$/
      })
    ).toBeTruthy()
  })

  it('sits next to the brand on the start screens', async () => {
    const view = render(
      <BuildToolsHost client={CLIENT}>
        <StartFrame
          projectName="TextBolt"
          domain="textbolt.com"
          searchesLeft={60}
          title="How do you want to start?"
          footer={null}
        >
          <p>Body</p>
        </StartFrame>
      </BuildToolsHost>
    )
    const banner = view.getByRole('banner')
    const chip = await within(banner).findByRole('button', { name: /v0\.11\.0/ })
    expect(chip.closest('.sf-brand-group')?.querySelector('.sf-brand')).toBeTruthy()
  })
})

describe('the window toast', () => {
  it('shows a link after the message when one is given, and closes when it is followed', () => {
    function Notify(): JSX.Element {
      const { notify } = useBuildTools()
      return (
        <button
          type="button"
          onClick={() =>
            notify('6 questions added', 'ok', {
              label: 'View them',
              href: '#/questions?source=topic-1'
            })
          }
        >
          Add
        </button>
      )
    }
    const view = render(
      <BuildToolsHost client={CLIENT}>
        <Notify />
      </BuildToolsHost>
    )
    fireEvent.click(view.getByRole('button', { name: 'Add' }))
    const link = view.getByRole('link', { name: 'View them' })
    expect(link.getAttribute('href')).toBe('#/questions?source=topic-1')
    expect(link.closest('.bm-toast')?.textContent).toContain('6 questions added')
    fireEvent.click(link)
    expect(view.queryByRole('link', { name: 'View them' })).toBeNull()
  })
})
