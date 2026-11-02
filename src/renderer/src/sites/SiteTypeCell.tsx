import type { JSX } from 'react'
import { customTypeChoice } from '@shared/site-overrides'
import { SITE_ROLE_LABELS, SITE_ROLES } from '@shared/site-role'
import { Chip, type MenuItem } from '../ui'
import { RELATION_TONE, siteTypeHint, siteTypeName } from './siteRows'
import { CellMenu, EditedMark, QuickAction } from './SourceCells'
import type { SourceLine } from './sources'
import type { SourceActions } from './useSourceActions'

/**
 * A site list's one Type column: who the site is to you, in the words the Sources tab
 * uses. With the actions it opens a menu of every choice (Competitor, the platform
 * roles, Neutral and the project's own types), the current one ticked, with "Reset to
 * automatic"; a choice is saved for the domain, so every list with that site changes.
 * A neutral site offers "Mark as competitor" on hover; a known platform never does.
 */
export function SiteTypeCell({
  line,
  actions,
  topic = false,
  hint
}: {
  line: SourceLine
  actions: SourceActions
  topic?: boolean
  /** A fuller tooltip than the type's own, such as "Partial competitor". */
  hint?: string
}): JSX.Element {
  const { relation } = line
  const label = siteTypeName(line, topic)
  const title = hint ?? siteTypeHint(line)
  const shown =
    relation.kind === 'neutral' && !line.customType ? (
      <span className="site-faint">{label}</span>
    ) : (
      <Chip
        size="sm"
        tone={
          line.customType && relation.kind !== 'competitor'
            ? line.customType.tone
            : RELATION_TONE[relation.kind === 'neutral' ? 'platform' : relation.kind]
        }
      >
        {label}
      </Chip>
    )
  const own = relation.kind === 'target' || relation.kind === 'own'
  const { setRole, setType } = actions
  const edited = line.roleEdited || line.typeEdited
  const quick =
    relation.kind === 'neutral' && actions.markCompetitor ? (
      <QuickAction
        label="Mark as competitor"
        name={`Mark ${line.domain} as a competitor`}
        busy={actions.saving === line.key}
        disabled={actions.saving !== null}
        onClick={() => actions.markCompetitor?.(line)}
      />
    ) : null
  if (!setRole || own) {
    return (
      <span className="site-cell-row" title={title}>
        {shown}
        {quick}
      </span>
    )
  }
  const competitor = relation.kind === 'competitor'
  const reset = (): void => setRole(line, null, { clearType: true })
  const items: MenuItem[] = [
    {
      id: 'type-competitor',
      label: 'Competitor',
      checked: competitor,
      disabled: actions.markCompetitor === null,
      onSelect: () => {
        if (!competitor) actions.markCompetitor?.(line)
      }
    },
    ...SITE_ROLES.map((role, index) => ({
      id: `type-${role}`,
      label: SITE_ROLE_LABELS[role],
      groupStart: index === 0,
      checked:
        !competitor &&
        line.customType === null &&
        (role === 'neutral'
          ? relation.kind === 'neutral'
          : relation.kind === 'platform' && relation.role === role),
      // Picking a role drops a type of your own, so the column shows what was picked.
      onSelect: () => setRole(line, role, { clearType: line.customType !== null })
    })),
    // A competitor stays one: a type of its own would never show.
    ...(competitor || !setType
      ? []
      : [
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
            : [])
        ]),
    ...(actions.manageTypes
      ? [
          {
            id: 'type-manage',
            label: 'Manage types…',
            icon: 'settings' as const,
            groupStart: competitor,
            onSelect: () => actions.manageTypes?.()
          }
        ]
      : []),
    {
      id: 'type-reset',
      label: 'Reset to automatic',
      icon: 'refresh',
      groupStart: true,
      disabled: !edited,
      onSelect: reset
    }
  ]
  return (
    <span className="site-cell-row">
      <CellMenu
        label={`Type for ${line.site}: ${label}`}
        hint={title}
        items={items}
        busy={actions.saving === line.key}
      >
        {shown}
      </CellMenu>
      {edited ? <EditedMark site={line.site} what="type" onReset={reset} /> : null}
      {quick}
    </span>
  )
}
