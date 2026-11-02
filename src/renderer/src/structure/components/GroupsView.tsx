import { useId, useState, type FormEvent, type JSX } from 'react'
import type { GroupSummary } from '@shared/domain'
import type { StructureView } from '@shared/ipc'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { openDrawer, useDrawerStack } from '../../shell/drawers'
import { navigateHash, pagesHash } from '../../shell/routes'
import { Button, EmptyState, ListGrid, type ListColumn, type MenuItem } from '../../ui'
import type { StructureClient } from '../client'
import { GROUPS_NOTE } from '../constants'
import type { StructureDrills } from '../hooks/useStructureDrills'
import type { RunAction } from '../types'
import { AverageScore, PageCount } from './ClusterDrills'

type GroupEdit = { mode: 'create' } | { mode: 'rename' | 'delete'; group: GroupSummary }

/**
 * FR-19.7. User-made lists as one grid. Claude never changes them. A group's
 * pages open in the 80% group drawer (`drawer=group&group.id=…`), where
 * "Add pages" stacks the page picker.
 */
export function GroupsView({
  client,
  projectId,
  view,
  drills,
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  view: StructureView
  drills: StructureDrills
  run: RunAction
  busy: string | null
}): JSX.Element {
  const { stack } = useDrawerStack()
  const openId = stack.find((entry) => entry.id === 'group')?.params['group.id'] ?? null
  const [edit, setEdit] = useState<GroupEdit | null>(null)
  const disabled = busy !== null

  function show(groupId: string): void {
    openDrawer('group', { 'group.id': groupId })
  }

  const columns: ListColumn<GroupSummary>[] = [
    {
      id: 'name',
      label: 'Group',
      width: 'fill',
      minWidth: 200,
      sort: (group) => group.name.toLowerCase(),
      render: (group) => (
        <span className="str-name-cell">
          <button
            type="button"
            className="str-row-link"
            aria-label={`Show pages of ${group.name}`}
            onClick={() => show(group.id)}
          >
            {group.name}
          </button>
          {group.note ? <span className="str-muted str-clip">{group.note}</span> : null}
        </span>
      )
    },
    {
      id: 'pages',
      label: 'Pages',
      width: 80,
      numeric: true,
      sort: (group) => group.pageCount,
      render: (group) => <PageCount drills={drills} group={group} part="all" />
    },
    {
      id: 'tracked',
      label: 'Tracked',
      width: 80,
      numeric: true,
      sort: (group) => group.trackedCount,
      render: (group) => <PageCount drills={drills} group={group} part="tracked" />
    },
    {
      id: 'score',
      label: 'Avg score',
      width: 96,
      numeric: true,
      sort: (group) => group.averageScore,
      render: (group) => <AverageScore drills={drills} group={group} />
    },
    askColumn(
      (group) => ({
        kind: 'group',
        id: group.id,
        label: group.name,
        detail: `${group.trackedCount} of ${group.pageCount} pages tracked`
      }),
      (group) => [
        `How are the pages in “${group.name}” doing?`,
        `Which pages in “${group.name}” should I fix first?`,
        `Summarise “${group.name}” for my client in 5 lines`
      ]
    )
  ]

  function rowMenu(group: GroupSummary): MenuItem[] {
    return [
      {
        id: 'pages',
        label: 'Show pages',
        icon: 'layers',
        onSelect: () => show(group.id)
      },
      {
        id: 'add',
        label: 'Add pages…',
        icon: 'plus',
        onSelect: () => openDrawer('pick-pages', { 'pick.for': `group:${group.id}` })
      },
      {
        id: 'all-pages',
        label: 'Open in All pages',
        icon: 'arrow-right',
        onSelect: () => navigateHash(pagesHash({ group: group.id }))
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'pencil',
        onSelect: () => setEdit({ mode: 'rename', group })
      },
      {
        id: 'delete',
        label: 'Delete group',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => setEdit({ mode: 'delete', group })
      }
    ]
  }

  return (
    <div className="page-stack">
      <p className="str-hint">{GROUPS_NOTE}</p>
      {edit ? (
        <GroupEditBar
          key={edit.mode === 'create' ? 'create' : `${edit.mode}:${edit.group.id}`}
          client={client}
          projectId={projectId}
          edit={edit}
          run={run}
          disabled={disabled}
          onDone={() => setEdit(null)}
        />
      ) : null}
      <ListGrid
        label="Groups"
        noun={['group', 'groups']}
        rows={view.groups}
        rowKey={(group) => group.id}
        rowLabel={(group) => group.name}
        columns={columns}
        search={{ text: (group) => `${group.name} ${group.note ?? ''}` }}
        actions={
          <Button size="sm" icon="plus" onClick={() => setEdit({ mode: 'create' })}>
            New group
          </Button>
        }
        rowMenu={rowMenu}
        onActivate={(group) => show(group.id)}
        isRowCurrent={(group) => group.id === openId}
        empty={
          <EmptyState
            icon="layers"
            title="No groups yet"
            body="Make a list of pages for a report or a round of updates."
            action={
              <Button size="sm" icon="plus" onClick={() => setEdit({ mode: 'create' })}>
                New group
              </Button>
            }
          />
        }
      />
    </div>
  )
}

/** Create, rename or delete a group, in one bar above the grid. */
function GroupEditBar({
  client,
  projectId,
  edit,
  run,
  disabled,
  onDone
}: {
  client: StructureClient
  projectId: string
  edit: GroupEdit
  run: RunAction
  disabled: boolean
  onDone: () => void
}): JSX.Element {
  const id = useId()
  const [name, setName] = useState(edit.mode === 'create' ? '' : edit.group.name)
  const [note, setNote] = useState('')

  if (edit.mode === 'delete') {
    const { group } = edit
    return (
      <div className="str-edit-bar" role="group" aria-label={`Delete ${group.name}`}>
        <span role="status">Delete “{group.name}”? Its pages stay in CiteFox.</span>
        <span className="str-grow" />
        <Button
          size="sm"
          variant="danger"
          disabled={disabled}
          onClick={() =>
            void run('Delete group', () =>
              client['structure:deleteGroup']({ projectId, groupId: group.id })
            ).then((done) => {
              if (done) onDone()
            })
          }
        >
          Delete group
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Keep it
        </Button>
      </div>
    )
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    const done =
      edit.mode === 'create'
        ? await run('Create group', () =>
            client['structure:createGroup']({
              projectId,
              name: trimmed,
              note: note.trim().length > 0 ? note.trim() : null
            })
          )
        : await run('Rename group', () =>
            client['structure:renameGroup']({
              projectId,
              groupId: edit.group.id,
              name: trimmed,
              note: edit.group.note
            })
          )
    if (done) onDone()
  }

  return (
    <form
      className="str-edit-bar"
      aria-label={edit.mode === 'create' ? 'New group' : `Rename ${edit.group.name}`}
      onSubmit={(event) => void submit(event)}
    >
      <label className="str-field-label" htmlFor={`${id}-n`}>
        {edit.mode === 'create' ? 'Group name' : `New name for ${edit.group.name}`}
      </label>
      <input
        id={`${id}-n`}
        className="ui-input ui-input-sm str-grow"
        value={name}
        maxLength={80}
        required
        // Opened from a button: put the cursor where the typing goes.
        autoFocus
        onChange={(event) => setName(event.currentTarget.value)}
      />
      {edit.mode === 'create' ? (
        <>
          <label className="str-field-label" htmlFor={`${id}-note`}>
            Note <span className="str-muted">(optional)</span>
          </label>
          <input
            id={`${id}-note`}
            className="ui-input ui-input-sm str-grow"
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </>
      ) : null}
      <Button type="submit" size="sm" disabled={disabled}>
        {edit.mode === 'create' ? 'Create group' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}
