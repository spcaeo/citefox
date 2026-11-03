// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AppSettingsPatch, CitationNews } from '@shared/ipc'
import { onCelebrationPreview } from '../celebrate/preview'
import { getCelebrate, getCelebrateSound } from '../celebrate/setting'
import { createMockOnboardingClient } from '../onboarding/mockClient'
import type { OnboardingClient } from '../onboarding/client'
import { createMockAlertsClient } from '../alerts/mock'
import { dataFolderLabel } from './utils/dataFolder'
import { SettingsScreen } from './SettingsScreen'
import { draftFromSettings } from './validate'

afterEach(() => {
  cleanup()
  // The open tab lives in the hash; start each test on the default tab.
  window.location.hash = ''
})

async function renderScreen(
  updateSettings?: OnboardingClient['updateSettings']
): Promise<{ saves: AppSettingsPatch[] }> {
  const base = createMockOnboardingClient({ wait: () => Promise.resolve() })
  const saves: AppSettingsPatch[] = []
  const client: OnboardingClient = {
    ...base,
    updateSettings: (patch) => {
      saves.push(patch)
      return updateSettings ? updateSettings(patch) : base.updateSettings(patch)
    }
  }
  const snapshot = await base.getSettings()
  const overview = await base.getOverview()
  render(
    <SettingsScreen
      client={client}
      alertsClient={createMockAlertsClient()}
      overview={overview}
      settings={{ ...draftFromSettings(snapshot.settings, ''), userName: 'Rakesh' }}
      dataDirectory={snapshot.dataDirectory}
      onChanged={() => Promise.resolve()}
    />
  )
  return { saves }
}

function pathField(): HTMLInputElement {
  return screen.getByLabelText('Claude binary path')
}

describe('SettingsScreen Claude binary path', () => {
  test('shows the path problem on the field and does not save', async () => {
    const { saves } = await renderScreen()
    fireEvent.change(pathField(), { target: { value: '/bin/bash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    const message = await screen.findByText(
      'The Claude Code path must point to the claude program.'
    )
    expect(message.id).toBe('claude-path-error')
    expect(pathField().getAttribute('aria-invalid')).toBe('true')
    expect(pathField().getAttribute('aria-describedby')).toContain('claude-path-error')
    expect(saves).toEqual([])
  })

  test("shows main's rejection without Electron's wrapper, on the field", async () => {
    const reject = vi.fn<OnboardingClient['updateSettings']>(() =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'settings:update': Error: settings:update: The Claude Code path must point to the claude.exe or claude.cmd program."
        )
      )
    )
    const { saves } = await renderScreen(reject)
    fireEvent.change(pathField(), { target: { value: '/usr/local/bin/claude' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => {
      expect(saves).toHaveLength(1)
    })
    const message = 'The Claude Code path must point to the claude.exe or claude.cmd program.'
    await waitFor(() => {
      expect(document.getElementById('claude-path-error')?.textContent).toBe(message)
    })
    const statuses = screen.getAllByRole('status').map((element) => element.textContent)
    expect(statuses).toContain(message)
    expect(document.body.textContent).not.toContain('Error invoking remote method')
    expect(document.body.textContent).not.toContain('settings:update')
    expect(pathField().getAttribute('aria-invalid')).toBe('true')
  })

  test('saves an empty path as null', async () => {
    const { saves } = await renderScreen()
    fireEvent.change(pathField(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings saved.')
    expect(saves[0]?.claudeBinaryPath).toBeNull()
  })
})

describe('SettingsScreen tabs', () => {
  test('five tabs: AI & searches, General, Email, Reports, and Data & about', async () => {
    await renderScreen()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'AI & searches',
      'General',
      'Email',
      'Reports',
      'Data & about'
    ])
  })

  test('Reports asks who the reports are from, for every project', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    expect(
      await screen.findByRole('radiogroup', { name: 'Who are these reports from?' })
    ).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Just me/ })).toBeTruthy()
  })

  test('a problem on another tab opens that tab when saving', async () => {
    const { saves } = await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    fireEvent.change(screen.getByLabelText('Samples per question'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('tab', { name: 'AI & searches' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe(
        'true'
      )
    )
    expect(screen.getByLabelText('Samples per question').getAttribute('aria-invalid')).toBe('true')
    expect(saves).toEqual([])
  })

  test('the open tab is in the URL, and the URL opens its tab', async () => {
    window.location.hash = '#/settings?tab=data'
    await renderScreen()
    expect(screen.getByRole('tab', { name: 'Data & about' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    expect(window.location.hash).toBe('#/settings?tab=general')
    fireEvent.click(screen.getByRole('tab', { name: 'AI & searches' }))
    expect(window.location.hash).toBe('#/settings')
  })

  test('the theme is not here: it lives in the top bar', async () => {
    window.location.hash = '#/settings?tab=general'
    await renderScreen()
    expect(screen.queryByRole('radio', { name: 'Dark' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Appearance' })).toBeNull()
  })

  test('General saves "Celebrate citations" and "Play a sound" at once', async () => {
    window.location.hash = '#/settings?tab=general'
    const { saves } = await renderScreen()
    const celebrate = screen.getByRole('checkbox', { name: /Celebrate citations/ })
    const sound = screen.getByRole('checkbox', { name: /Play a sound/ }) as HTMLInputElement
    expect(sound.checked).toBe(true)
    fireEvent.click(sound)
    await waitFor(() => {
      expect(saves).toEqual([{ celebrateSound: false }])
    })
    expect(getCelebrateSound()).toBe(false)
    // With celebrations off there is nothing to play a sound with.
    fireEvent.click(celebrate)
    await waitFor(() => {
      expect(saves.at(-1)).toEqual({ celebrate: false })
    })
    expect(sound.disabled).toBe(true)
    fireEvent.click(celebrate)
    fireEvent.click(sound)
    await waitFor(() => {
      expect(saves.at(-1)).toEqual({ celebrateSound: true })
    })
    expect(getCelebrate()).toBe(true)
    expect(getCelebrateSound()).toBe(true)
  })

  test('General has a Preview of the celebration', async () => {
    window.location.hash = '#/settings?tab=general'
    await renderScreen()
    const previews: CitationNews[] = []
    const stop = onCelebrationPreview((news) => previews.push(news))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    stop()
    expect(previews).toEqual([expect.objectContaining({ kind: 'cited', brand: 'Your site' })])
  })

  test('AI & searches has no Keys panel and edits no key', async () => {
    await renderScreen()
    expect(screen.queryByRole('grid', { name: 'Services' })).toBeNull()
    expect(screen.queryByText('Keys are added, tested and replaced in Connections.')).toBeNull()
    // No key editing here: no secret field and no key buttons.
    expect(screen.queryByLabelText('API key', { exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: /key$/ })).toBeNull()
  })

  test('AI & searches folds the model, calls, path and Jina under More settings', async () => {
    await renderScreen()
    const more = screen.getByText('More settings').closest('details') as HTMLDetailsElement
    expect(more.open).toBe(false)
    for (const label of [
      'Model',
      'Calls at once',
      'Claude binary path',
      'Read pages with Jina Reader'
    ]) {
      expect(more.contains(screen.getByLabelText(label))).toBe(true)
    }
    // A problem in one of its fields opens it.
    fireEvent.change(screen.getByLabelText('Calls at once'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(more.open).toBe(true))
  })

  test('General holds Check timing, with Save for the defaults; Email has its own URL', async () => {
    window.location.hash = '#/settings?tab=general'
    await renderScreen()
    expect(
      await screen.findByRole('switch', { name: 'Start CiteFox at login and keep it in the tray' })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }))
    expect(window.location.hash).toBe('#/settings?tab=email')
    expect(await screen.findByLabelText('Security')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Templates' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Connections' })).toBeNull()
  })

  test('Data & about shows the version, the licence, the sponsors, about us with links, and testing under More', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('tab', { name: 'Data & about' }))
    const about = screen.getByRole('region', { name: 'About CiteFox' })
    expect(await within(about).findByText('0.9.0')).toBeTruthy()
    expect(about.textContent).toContain('Source-available')
    const sponsors = screen.getByRole('region', { name: 'Sponsors' })
    expect(within(sponsors).getAllByRole('link').length).toBeGreaterThan(0)
    expect(sponsors.textContent).toContain('Why sponsors?')
    const us = screen.getByRole('region', { name: 'About us' })
    expect(us.textContent).toContain('Space-O Technologies')
    for (const label of ['Source code', 'Help docs', "What's new", 'Report a problem']) {
      expect(within(us).getByText(label)).toBeTruthy()
    }
    const opens = within(us)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    expect(opens).toContain('https://github.com/spcaeo/citefox')
    expect(opens).toContain('https://github.com/spcaeo/citefox/blob/main/Docs/help/README.md')
    const more = screen.getByText('More').closest('details') as HTMLDetailsElement
    expect(more.open).toBe(false)
    expect(more.contains(screen.getByRole('region', { name: 'Testing' }))).toBe(true)
    // Report a problem… opens the drawer on the URL, so a copied link reopens it.
    fireEvent.click(within(about).getByRole('button', { name: 'Report a problem…' }))
    expect(window.location.hash).toContain('drawer=report-problem')
  })
})

describe('SettingsScreen Run checkup with an unsaved path', () => {
  async function renderWithCheckup(): Promise<{ paths: (string | null)[] }> {
    const base = createMockOnboardingClient({ wait: () => Promise.resolve() })
    const paths: (string | null)[] = []
    const client: OnboardingClient = {
      ...base,
      runCheckup: (request) => {
        paths.push(request.binaryPath)
        return base.runCheckup(request)
      }
    }
    const snapshot = await base.getSettings()
    const overview = await base.getOverview()
    render(
      <SettingsScreen
        client={client}
        alertsClient={createMockAlertsClient()}
        overview={overview}
        settings={draftFromSettings(snapshot.settings, '')}
        dataDirectory={snapshot.dataDirectory}
        onChanged={() => Promise.resolve()}
      />
    )
    return { paths }
  }

  test('checks the typed path and says it is not saved yet', async () => {
    const { paths } = await renderWithCheckup()
    fireEvent.change(pathField(), { target: { value: '/Users/me/.local/bin/claude' } })
    expect(document.body.textContent).toContain('Runs with the path you typed.')
    fireEvent.click(screen.getByRole('button', { name: 'Run checkup' }))
    await waitFor(() => {
      expect(paths).toEqual(['/Users/me/.local/bin/claude'])
    })
    await waitFor(() => {
      expect(document.body.textContent).toContain(
        'Checked the path you typed; it is not saved yet.'
      )
    })
  })

  test('does not run with a typed path that cannot work, and says why', async () => {
    const { paths } = await renderWithCheckup()
    fireEvent.change(pathField(), { target: { value: 'claude' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run checkup' }))
    await screen.findByText('The Claude Code path must be a full path to the claude program.', {
      selector: '.conn .hint'
    })
    expect(paths).toEqual([])
  })
})

describe('SettingsScreen Data card', () => {
  test('Export all data asks main and says what it saved; a cancel stays quiet', async () => {
    const base = createMockOnboardingClient({ wait: () => Promise.resolve() })
    const exportAllData = vi
      .fn<OnboardingClient['exportAllData']>()
      .mockResolvedValueOnce({
        ok: true,
        filePath: '/Users/me/citefox-all-data-2026-10-20.zip',
        filename: 'citefox-all-data-2026-10-20.zip',
        bytes: 4096,
        projects: [
          {
            id: 'p1',
            name: 'TextBolt',
            slug: 'textbolt',
            file: 'projects/textbolt.citefox.json',
            error: null
          },
          {
            id: 'p2',
            name: 'Northwind',
            slug: 'northwind',
            file: null,
            error: 'This project could not be read, so it is not in the zip.'
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: false,
        cancelled: true,
        reason: 'Export cancelled',
        nextStep: 'Choose a file name and save.'
      })
    const openDataFolder = vi.fn<OnboardingClient['openDataFolder']>(() =>
      Promise.resolve({
        ok: false,
        reason: 'Could not open the folder.',
        nextStep: 'Open it from your file manager.'
      })
    )
    const client: OnboardingClient = { ...base, exportAllData, openDataFolder }
    const snapshot = await base.getSettings()
    render(
      <SettingsScreen
        client={client}
        alertsClient={createMockAlertsClient()}
        overview={await base.getOverview()}
        settings={draftFromSettings(snapshot.settings, '')}
        dataDirectory={snapshot.dataDirectory}
        onChanged={() => Promise.resolve()}
      />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Data & about' }))
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    const data = screen.getByRole('region', { name: 'Data' })
    expect(data.textContent).toContain(snapshot.dataDirectory)
    expect(data.textContent).toContain('Keys and passwords stay in the keychain.')

    fireEvent.click(screen.getByRole('button', { name: 'Export all data (JSON)' }))
    expect(
      await screen.findByText(
        /Saved citefox-all-data-2026-10-20\.zip \(4 KB, 1 project\)\. Not included: Northwind\./
      )
    ).toBeTruthy()
    expect(exportAllData).toHaveBeenCalledWith()

    fireEvent.click(screen.getByRole('button', { name: 'Export all data (JSON)' }))
    await waitFor(() => expect(exportAllData).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/Saved citefox/)).toBeNull())
    expect(screen.queryByText(/Export cancelled/)).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /^(Show in Finder|Show in Explorer|Open data folder)$/ })
    )
    expect(
      await screen.findByText('Could not open the folder. Open it from your file manager.')
    ).toBeTruthy()
    expect(openDataFolder).toHaveBeenCalledWith()
    expect(screen.getByRole('link', { name: 'Export report (HTML)' }).getAttribute('href')).toBe(
      '#/export'
    )
  })

  test('the reveal button is named for the file manager of this system', () => {
    expect(dataFolderLabel('mac')).toBe('Show in Finder')
    expect(dataFolderLabel('windows')).toBe('Show in Explorer')
    expect(dataFolderLabel('linux')).toBe('Open data folder')
    expect(dataFolderLabel('other')).toBe('Open data folder')
  })
})
