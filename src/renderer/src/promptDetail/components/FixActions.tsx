import type { JSX } from 'react'
import { navigateHash, pageHash } from '../../shell/routes'
import { IconButton, MenuButton, Panel, type MenuItem } from '../../ui'
import type { FixBriefState } from '../hooks/useFixBrief'

/**
 * The fix actions (FR-13.6), on the header's right (Docs/HEADER.md): Copy fix
 * brief is the screen's one green primary (`fixBriefPrimary`); Edit question
 * and Check now, then the brief, Content gaps and Progress sit under this ⋯.
 * The brief is built from this prompt's stored data only.
 */
export function FixMoreMenu({
  pageId,
  state,
  promptItems = []
}: {
  pageId: string
  state: FixBriefState
  /** Edit question and Check now, at the top of the menu. */
  promptItems?: readonly MenuItem[]
}): JSX.Element {
  return (
    <>
      <HeaderMenu
        label="More fix actions"
        items={[
          ...promptItems,
          {
            id: 'brief',
            groupStart: promptItems.length > 0,
            label: state.open ? 'Hide the brief' : 'Show the brief',
            icon: 'eye',
            onSelect: state.onToggle
          },
          {
            id: 'gaps',
            label: 'Plan the fix in Content gaps',
            icon: 'layers',
            onSelect: () => navigateHash(pageHash(pageId, 'gaps'))
          },
          {
            id: 'progress',
            label: 'Log a fix in Progress',
            icon: 'trend',
            onSelect: () => navigateHash(pageHash(pageId, 'progress'))
          }
        ]}
      />
      <span className="sr-only" role="status">
        {state.copy === 'copied' ? 'Fix brief copied.' : ''}
      </span>
    </>
  )
}

/**
 * The header's ⋯ drawn like ScreenHeader `more`, for menus whose items need
 * more than a header item has (stage choices with ticks, groups, Undo-backed
 * Remove).
 */
export function HeaderMenu({
  label,
  items
}: {
  label: string
  items: readonly MenuItem[]
}): JSX.Element {
  return (
    <MenuButton
      label={label}
      items={items}
      width={248}
      trigger={({ ref, ...props }) => (
        <IconButton
          ref={ref}
          icon="dots"
          label={label}
          data-tip={label}
          className="ui-head-more"
          {...props}
        />
      )}
    />
  )
}

/** The brief itself, shown on demand or when copying failed. */
export function FixBrief({ brief, state }: { brief: string; state: FixBriefState }): JSX.Element {
  return (
    <Panel title="Fix brief" titleAs="h2" padding={20}>
      <p className="pd2-note" role="status">
        {state.copy === 'failed'
          ? 'Could not copy. Select the brief below and copy it.'
          : 'Paste it into your editor or a chat with CiteFox AI.'}
      </p>
      <pre className="pd2-brief mono" id="pd-brief" tabIndex={0}>
        {brief}
      </pre>
    </Panel>
  )
}
