import { useId, useState, type JSX } from 'react'
import type { TopicFolder } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { Confirm, Drawer, DrawerField, DrawerSection, showUndo } from '../../../ui'
import { notifyTopicsChanged, type ClustersSource } from '../../clusters'
import { NO_FOLDER } from '../../views/model'
import type { FolderMode } from './rows'

const NEW = '\u0000new'
const NONE = '\u0000none'

type Channels = Pick<
  ClustersSource,
  'topics:createFolder' | 'topics:renameFolder' | 'topics:deleteFolder' | 'topics:moveToFolder'
>

/**
 * Topic folders (`drawer=topic-folder`): New folder (`tf.mode=create`, with `tf.topics`
 * to move in), Rename (`tf.folder`), Delete (its topics go back to "No folder"), and
 * Move to folder for some topics (`tf.topics`), with "New folder…" and "No folder".
 * Each change is saved at once and offers Undo where it can.
 */
export function FolderDrawer({
  mode,
  projectId,
  folders,
  folderId,
  topicIds,
  topicName,
  source,
  onClose
}: {
  mode: FolderMode
  projectId: string
  folders: readonly TopicFolder[]
  folderId: string | null
  topicIds: readonly string[]
  /** The one topic being moved, for the title. */
  topicName: string | null
  source: Channels
  onClose: () => void
}): JSX.Element {
  const folder = folders.find((item) => item.id === folderId) ?? null
  const current =
    topicIds.length === 1 ? folders.find((item) => item.topicIds.includes(topicIds[0] ?? '')) : null
  const [name, setName] = useState(mode === 'rename' ? (folder?.name ?? '') : '')
  const [pick, setPick] = useState<string>(
    mode === 'move' ? (current?.id ?? (folders.length === 0 ? NEW : NONE)) : NEW
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const group = useId()

  async function save(act: () => Promise<unknown>, done: () => void): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await act()
      notifyTopicsChanged()
      done()
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'That did not work. Try again.'))
      setBusy(false)
    }
  }

  if ((mode === 'rename' || mode === 'delete') && folder === null) {
    return (
      <Drawer id="topic-folder" title="Folder" onClose={onClose} footer={{ cancel: 'Close' }}>
        <p role="alert">That folder is not available to you.</p>
      </Drawer>
    )
  }

  if (mode === 'delete' && folder) {
    const count = folder.topicIds.length
    return (
      <Confirm
        title={`Delete the folder ${folder.name}?`}
        body={
          <>
            <p>
              {count === 0
                ? 'It has no topics.'
                : `Its ${count} ${count === 1 ? 'topic goes' : 'topics go'} back to ${NO_FOLDER}. No topic, question or check is deleted.`}
            </p>
            {error ? (
              <p className="ui-drawer-error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete folder"
        busy={busy}
        onCancel={onClose}
        onConfirm={() =>
          void save(
            () => source['topics:deleteFolder']({ projectId, folderId: folder.id }),
            () => showUndo({ message: `Deleted the folder ${folder.name}.`, testId: 'topic-undo' })
          )
        }
        testId="topic-folder-delete"
      />
    )
  }

  const trimmed = name.trim().replace(/\s+/gu, ' ')
  const needsName = mode === 'create' || mode === 'rename' || pick === NEW
  const nameError = needsName && trimmed.length > 80 ? 'A folder name is 1 to 80 characters.' : null
  const canSave = !busy && (!needsName || (trimmed.length > 0 && nameError === null))
  const moving = `${topicIds.length} ${topicIds.length === 1 ? 'topic' : 'topics'}`

  function submit(): void {
    if (!canSave) return
    if (mode === 'rename' && folder) {
      const before = folder.name
      void save(
        () => source['topics:renameFolder']({ projectId, folderId: folder.id, name: trimmed }),
        () =>
          showUndo({
            message: `Renamed to ${trimmed}.`,
            undo: async () => {
              await source['topics:renameFolder']({ projectId, folderId: folder.id, name: before })
              notifyTopicsChanged()
            },
            testId: 'topic-undo'
          })
      )
      return
    }
    if (mode === 'create' || pick === NEW) {
      void save(
        () =>
          source['topics:createFolder']({
            projectId,
            name: trimmed,
            ...(topicIds.length > 0 ? { topicIds } : {})
          }),
        () =>
          showUndo({
            message:
              topicIds.length > 0
                ? `Made ${trimmed} and moved ${moving} into it.`
                : `Made the folder ${trimmed}.`,
            testId: 'topic-undo'
          })
      )
      return
    }
    const target = pick === NONE ? null : pick
    const targetName =
      target === null ? NO_FOLDER : (folders.find((item) => item.id === target)?.name ?? '')
    // Undo puts each topic back in the folder it came from.
    const before = new Map(
      topicIds.map((id) => [id, folders.find((item) => item.topicIds.includes(id))?.id ?? null])
    )
    void save(
      () => source['topics:moveToFolder']({ projectId, topicIds, folderId: target }),
      () =>
        showUndo({
          message: `Moved ${moving} to ${targetName}.`,
          undo: async () => {
            const back = new Map<string | null, string[]>()
            for (const [id, from] of before) back.set(from, [...(back.get(from) ?? []), id])
            for (const [from, ids] of back) {
              await source['topics:moveToFolder']({ projectId, topicIds: ids, folderId: from })
            }
            notifyTopicsChanged()
          },
          testId: 'topic-undo'
        })
    )
  }

  const title =
    mode === 'rename'
      ? 'Rename folder'
      : mode === 'create'
        ? 'New folder'
        : topicName
          ? `Move ${topicName} to a folder`
          : `Move ${moving} to a folder`
  const nameField = (
    <DrawerField label="Folder name" error={nameError ?? undefined}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className="ui-input"
          value={name}
          maxLength={120}
          autoFocus
          aria-describedby={describedBy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      )}
    </DrawerField>
  )
  return (
    <Drawer
      id="topic-folder"
      title={title}
      subtitle="Folders only sort your topics. Nothing is checked again."
      onClose={onClose}
      dirty={mode === 'rename' ? trimmed !== folder?.name : trimmed.length > 0}
      closeDisabled={busy}
      footer={{
        primary: {
          label: mode === 'rename' ? 'Save name' : mode === 'create' ? 'Make folder' : 'Move',
          onClick: submit,
          disabled: !canSave,
          busy
        }
      }}
    >
      <DrawerSection title={mode === 'move' ? 'Folder' : 'Name'}>
        {mode === 'move' ? (
          <fieldset className="tl-folder-pick" aria-describedby={`${group}-hint`}>
            <legend className="sr-only">Folder</legend>
            {folders.map((item) => (
              <label key={item.id} className="tl-folder-option">
                <input
                  type="radio"
                  name={group}
                  checked={pick === item.id}
                  onChange={() => setPick(item.id)}
                />
                <span>{item.name}</span>
                <span className="faint num">
                  {item.topicIds.length} {item.topicIds.length === 1 ? 'topic' : 'topics'}
                </span>
              </label>
            ))}
            <label className="tl-folder-option">
              <input
                type="radio"
                name={group}
                checked={pick === NONE}
                onChange={() => setPick(NONE)}
              />
              <span>{NO_FOLDER}</span>
            </label>
            <label className="tl-folder-option">
              <input
                type="radio"
                name={group}
                checked={pick === NEW}
                onChange={() => setPick(NEW)}
              />
              <span>New folder…</span>
            </label>
            <p id={`${group}-hint`} className="faint">
              {current
                ? `Now in ${current.name}.`
                : topicIds.length === 1
                  ? `Now in ${NO_FOLDER}.`
                  : null}
            </p>
            {pick === NEW ? nameField : null}
          </fieldset>
        ) : (
          nameField
        )}
        {error ? (
          <p className="ui-drawer-error" role="alert">
            {error}
          </p>
        ) : null}
      </DrawerSection>
    </Drawer>
  )
}
