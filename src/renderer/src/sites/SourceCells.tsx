import type { JSX, ReactNode } from 'react'
import { customTypeChoice, PICKABLE_SITE_TYPES } from '@shared/site-overrides'
import { SITE_ROLE_HINTS, SITE_ROLE_LABELS, SITE_ROLES } from '@shared/site-role'
import { SITE_TYPE_HINTS, SITE_TYPE_LABELS } from '@shared/site-type'
import { displayUrl } from '../m3/model'
import { Chip, MenuButton, UiIcon, type MenuItem } from '../ui'
import type { SourceActions } from './useSourceActions'
import { RELATION_TONE } from './siteRows'
import './sites.css'
import { relationLabel, siteTypeLabel, type SourceLine, type SourceRelation } from './sources'

/**
 * The editable cells of a sources row. "Type of site" and "Who it is" open a menu of
 * every choice, the current one ticked, with "Reset to automatic"; a choice is saved
 * for the domain, so every list with that site changes. A cell the user set shows a
 * small "edited" mark that puts it back to automatic.
 */

const OWN = new Set<SourceRelation['kind']>(['target', 'own'])

/** The site's type: plain words, a custom type as its coloured chip. */
export function TypeCell({
  line,
  actions
}: {
  line: SourceLine
  actions: SourceActions
}): JSX.Element {
  const label = siteTypeLabel(line)
  const shown = line.customType ? (
    <Chip size="sm" tone={line.customType.tone}>
      {label}
    </Chip>
  ) : (
    <span className="site-type-text">{label}</span>
  )
  const hint = line.customType ? 'A type of your own.' : SITE_TYPE_HINTS[line.type]
  const { setType } = actions
  if (!setType || OWN.has(line.relation.kind)) {
    return (
      <span className="site-type-text" title={hint}>
        {shown}
      </span>
    )
  }
  const items: MenuItem[] = [
    ...PICKABLE_SITE_TYPES.map((type) => ({
      id: `type-${type}`,
      label: SITE_TYPE_LABELS[type],
      checked: line.customType === null && line.type === type,
      onSelect: () => setType(line, type)
    })),
    ...actions.settings.customTypes.map((type, index) => ({
      id: `type-custom-${type.id}`,
      label: type.name,
      groupStart: index === 0,
      groupLabel: index === 0 ? 'Your types' : undefined,
      checked: line.customType?.id === type.id,
      onSelect: () => setType(line, customTypeChoice(type.id))
    })),
    ...(actions.newType
      ? [
          {
            id: 'type-new',
            label: 'New type…',
            icon: 'plus' as const,
            groupStart: true,
            onSelect: () => actions.newType?.(line)
          }
        ]
      : []),
    ...(actions.manageTypes
      ? [
          {
            id: 'type-manage',
            label: 'Manage types…',
            icon: 'settings' as const,
            onSelect: () => actions.manageTypes?.()
          }
        ]
      : []),
    {
      id: 'type-reset',
      label: 'Reset to automatic',
      icon: 'refresh',
      groupStart: true,
      disabled: !line.typeEdited,
      onSelect: () => setType(line, null)
    }
  ]
  return (
    <span className="site-cell-row">
      <CellMenu
        label={`Type of site for ${line.site}: ${label}`}
        hint={hint}
        items={items}
        busy={actions.saving === line.key}
      >
        {shown}
      </CellMenu>
      {line.typeEdited ? (
        <EditedMark site={line.site} what="type" onReset={() => setType(line, null)} />
      ) : null}
    </span>
  )
}

/** Who the source is to you, with the one quick action that fits it. */
export function WhoCell({
  line,
  topic,
  actions
}: {
  line: SourceLine
  topic: boolean
  actions: SourceActions
}): JSX.Element {
  const { relation } = line
  const label = relationLabel(relation, topic)
  const hint = relation.kind === 'neutral' ? SITE_ROLE_HINTS.neutral : undefined
  const shown =
    relation.kind === 'neutral' ? (
      <span className="site-faint">{label}</span>
    ) : (
      <Chip size="sm" tone={RELATION_TONE[relation.kind]}>
        {label}
      </Chip>
    )
  const { setRole } = actions
  if (!setRole || OWN.has(relation.kind)) {
    return (
      <span className="site-cell-row" title={hint}>
        {shown}
        <UntrackedNote relation={relation} line={line} actions={actions} />
      </span>
    )
  }
  const competitor = relation.kind === 'competitor'
  const items: MenuItem[] = [
    {
      id: 'role-competitor',
      label: 'Competitor',
      checked: competitor,
      disabled: actions.markCompetitor === null,
      onSelect: () => {
        if (!competitor) setRole(line, 'competitor')
      }
    },
    ...SITE_ROLES.map((role, index) => ({
      id: `role-${role}`,
      label: SITE_ROLE_LABELS[role],
      groupStart: index === 1,
      checked:
        role === 'neutral'
          ? relation.kind === 'neutral'
          : relation.kind === 'platform' && relation.role === role,
      onSelect: () => setRole(line, role)
    })),
    {
      id: 'role-reset',
      label: 'Reset to automatic',
      icon: 'refresh',
      groupStart: true,
      disabled: !line.roleEdited,
      onSelect: () => setRole(line, null)
    }
  ]
  return (
    <span className="site-cell-row">
      <CellMenu
        label={`Who ${line.site} is: ${label}`}
        hint={hint}
        items={items}
        busy={actions.saving === line.key}
      >
        {shown}
      </CellMenu>
      {line.roleEdited ? (
        <EditedMark site={line.site} what="who it is" onReset={() => setRole(line, null)} />
      ) : null}
      {relation.kind === 'neutral' && actions.markCompetitor ? (
        <QuickAction
          label="Mark as competitor"
          name={`Mark ${line.domain} as a competitor`}
          guide={`mark-competitor:${line.domain}`}
          busy={actions.saving === line.key}
          disabled={actions.saving !== null}
          onClick={() => actions.markCompetitor?.(line)}
        />
      ) : null}
    </span>
  )
}

/** The cell's value as a button that opens its menu of choices (Enter, Space or ↓). */
export function CellMenu({
  label,
  hint,
  items,
  busy,
  children
}: {
  label: string
  hint: string | undefined
  items: readonly MenuItem[]
  busy: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <MenuButton
      label={label}
      items={items}
      align="start"
      width={232}
      trigger={({ ref, onClick, ...props }) => (
        <button
          ref={ref}
          type="button"
          className="site-pick"
          aria-label={label}
          title={hint}
          aria-busy={busy || undefined}
          {...props}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
        >
          {children}
          <UiIcon name="chevron-down" size={12} className="site-pick-icon" />
        </button>
      )}
    />
  )
}

/** "edited": the user set this cell. A press puts it back to automatic (with Undo). */
export function EditedMark({
  site,
  what,
  onReset
}: {
  site: string
  what: string
  onReset: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="site-edited"
      title="You set this. Reset to automatic"
      aria-label={`You set ${what} for ${site}. Reset to automatic`}
      onClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
    >
      edited
    </button>
  )
}

function UntrackedNote({
  relation,
  line,
  actions
}: {
  relation: SourceRelation
  line: SourceLine
  actions: SourceActions
}): JSX.Element | null {
  if (relation.kind !== 'own' || relation.tracked) return null
  return (
    <>
      <span
        className="site-faint site-note"
        title="CiteFox doesn't check this page on its own yet. Track it to see where it is cited."
      >
        not tracked
      </span>
      <QuickAction
        label="Track"
        name={`Track ${displayUrl(line.url)}`}
        onClick={() => actions.trackPage(line)}
      />
    </>
  )
}

/** A small text button that shows while its row is hovered or focused (always on touch screens). */
export function QuickAction({
  label,
  name,
  busy = false,
  disabled = false,
  guide,
  onClick
}: {
  label: string
  name: string
  /** `data-guide`, for the first-run guide's pointer. */
  guide?: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="ui-btn ui-btn-text ui-btn-sm site-quick"
      aria-label={name}
      aria-busy={busy || undefined}
      data-guide={guide}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {busy ? 'Saving…' : label}
    </button>
  )
}
