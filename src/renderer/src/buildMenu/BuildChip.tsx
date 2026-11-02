import type { JSX } from 'react'
import { MenuButton, type MenuItem } from '../ui/Menu'
import { UiIcon } from '../ui/UiIcon'
import { buildLine, chipParts, menuTitle } from './buildInfo'
import {
  COPY_BUILD_INFO,
  FRESH_TEST_PROFILE,
  resetLabel,
  TEST_AS_NEW_USER,
  useBuildActions
} from './useBuildActions'

/**
 * The build chip in every top bar (owner feedback batch 2): `v0.11.0 ·
 * 22 Oct · 1787acc`, with a "Test profile" badge in a test window. It opens
 * the build menu: the full version and build, Copy build info, Reset keeping
 * the keys, and the two test-profile actions. Nothing shows until the app
 * info is read.
 */
export function BuildChip({ align = 'end' }: { align?: 'start' | 'end' }): JSX.Element | null {
  const actions = useBuildActions()
  const { info, testProfile } = actions
  if (!info) return null
  const parts = chipParts(info)
  const line = buildLine(info)

  const items: MenuItem[] = [
    {
      id: 'copy',
      label: actions.copied ? 'Copied' : COPY_BUILD_INFO,
      icon: actions.copied ? 'check' : 'copy',
      tone: actions.copied ? 'ok' : 'default',
      keepOpen: true,
      onSelect: () => void actions.copyBuildInfo()
    },
    {
      id: 'reset',
      label: resetLabel(testProfile),
      icon: 'refresh',
      groupStart: true,
      onSelect: () => actions.openDialog('reset')
    },
    ...(testProfile
      ? []
      : [
          {
            id: 'test',
            label: TEST_AS_NEW_USER,
            icon: 'external',
            disabled: actions.opening,
            groupStart: true,
            onSelect: () => void actions.testAsNewUser()
          } satisfies MenuItem,
          {
            id: 'fresh',
            label: FRESH_TEST_PROFILE,
            icon: 'plus',
            onSelect: () => actions.openDialog('fresh-test')
          } satisfies MenuItem
        ])
  ]

  return (
    <MenuButton
      label="Build menu"
      align={align}
      width={300}
      items={items}
      header={
        <div className="bm-head">
          <p className="bm-head-title">
            {menuTitle(info)}
            {testProfile ? <span className="bm-badge">Test profile</span> : null}
          </p>
          {line ? <p className="bm-head-build num">{line}</p> : null}
        </div>
      }
      trigger={(props, open) => (
        <button
          type="button"
          className="bm-chip"
          data-open={open || undefined}
          data-test-profile={testProfile || undefined}
          {...props}
        >
          {testProfile ? <span className="bm-badge">Test profile</span> : null}
          <span className="bm-chip-text num">
            {parts.version}
            {parts.date ? <span className="bm-chip-part"> · {parts.date}</span> : null}
            {parts.commit ? (
              <span className="bm-chip-part">
                {' · '}
                <span className="bm-commit">{parts.commit}</span>
              </span>
            ) : null}
          </span>
          <UiIcon name="chevron-down" size={14} />
        </button>
      )}
    />
  )
}
