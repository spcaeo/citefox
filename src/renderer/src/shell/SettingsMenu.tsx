import { useState, type JSX } from 'react'
import { useBuildActions } from '../buildMenu'
import { releaseText } from '../buildMenu/buildInfo'
import { MenuButton, type MenuItem } from '../ui/Menu'
import { UiIcon } from '../ui/UiIcon'
import { canCheckForUpdates, checkForUpdates, useUpdateStatus } from '../updates/updateStore'
import { navigateHash, sectionHash } from './routes'

/** The project's releases, opened when this window cannot check by itself. */
export const RELEASES_URL = 'https://github.com/spcaeo/citefox/releases'

type CheckState = 'idle' | 'checking' | 'newest' | 'failed'

/** The hint after "Check for updates": what the last check found. */
function checkHint(state: CheckState, newer: string | null): string | undefined {
  if (state === 'checking') return 'Checking…'
  if (newer) return `v${newer} out`
  if (state === 'newest') return 'Up to date'
  if (state === 'failed') return 'Offline'
  return undefined
}

/**
 * The ⚙ menu at the top bar's right end (Header.dc.html): App settings,
 * Connections and keys, searches left and setup steps (each opens what
 * the old status pill opened), then the version line (it copies the build
 * info) and Check for updates. It replaces the build chip; the testing tools
 * stay in Settings › Data & about, and the theme has its own button (`ThemeMenu`).
 */
export function SettingsMenu({
  searches,
  setup,
  onOpenStatus
}: {
  /** "31,898 searches left", or null before a search key gives a count. */
  searches: string | null
  /** "Setup: 1 step left", or null when nothing is left. */
  setup: string | null
  /** Opens the Credits and connections popover. */
  onOpenStatus: () => void
}): JSX.Element {
  const actions = useBuildActions()
  const { info, testProfile, copied } = actions
  const update = useUpdateStatus()
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const newer = update.available ? (update.latest?.version ?? null) : null

  async function runCheck(): Promise<void> {
    if (!canCheckForUpdates()) {
      window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')
      return
    }
    setCheckState('checking')
    try {
      const status = await checkForUpdates()
      setCheckState(status === null ? 'idle' : status.failed ? 'failed' : 'newest')
    } catch {
      setCheckState('failed')
    }
  }

  const version = info ? releaseText(info) : null
  const items: MenuItem[] = [
    {
      id: 'settings',
      label: 'App settings',
      icon: 'sliders',
      onSelect: () => navigateHash(sectionHash('settings'))
    },
    {
      id: 'connections',
      label: 'Connections and keys',
      icon: 'bolt',
      groupStart: true,
      onSelect: () => navigateHash(sectionHash('connections'))
    },
    {
      id: 'searches',
      label: `${searches ?? 'Searches left'} · details`,
      icon: 'gauge',
      groupStart: true,
      onSelect: onOpenStatus
    },
    ...(setup
      ? [
          {
            id: 'setup',
            label: setup,
            icon: 'warning',
            onSelect: () => navigateHash(sectionHash('permissions'))
          } satisfies MenuItem
        ]
      : []),
    ...(version
      ? [
          {
            id: 'version',
            label: testProfile ? `${version} · Test profile` : version,
            ariaLabel: `${version}${testProfile ? ' · Test profile' : ''}: copy build info`,
            hint: copied ? 'Copied' : 'Copy',
            icon: copied ? 'check' : 'copy',
            tone: copied ? 'ok' : 'default',
            keepOpen: true,
            groupStart: true,
            onSelect: () => void actions.copyBuildInfo()
          } satisfies MenuItem
        ]
      : []),
    {
      id: 'updates',
      label: 'Check for updates',
      icon: 'refresh',
      ...(version ? {} : { groupStart: true }),
      ...(checkHint(checkState, newer) ? { hint: checkHint(checkState, newer) } : {}),
      keepOpen: true,
      onSelect: () => void runCheck()
    },
    ...(newer && update.latest
      ? [
          {
            id: 'download-update',
            label: `Download v${newer}`,
            icon: 'download',
            tone: 'ok',
            onSelect: () => {
              window.open(update.latest?.downloadUrl, '_blank', 'noopener,noreferrer')
            }
          } satisfies MenuItem
        ]
      : [])
  ]

  return (
    <MenuButton
      label="Settings menu"
      align="end"
      width={272}
      items={items}
      trigger={(props, open) => (
        <button
          type="button"
          className="topbar-icon topbar-settings"
          aria-label="Settings menu"
          data-tip="Settings and version"
          data-open={open || undefined}
          data-test-profile={testProfile || undefined}
          {...props}
        >
          <UiIcon name="settings" />
        </button>
      )}
    />
  )
}
