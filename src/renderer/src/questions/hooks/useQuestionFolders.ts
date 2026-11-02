import { useEffect, useState } from 'react'
import type { TopicFolder } from '@shared/ipc'
import { onTopicsChanged } from '../../topics/clusters'
import type { QuestionsSource } from '../source'

/**
 * The project's topic folders, for the `folder=` filter the Topics dashboard links to.
 * Empty while loading, when the source has no folders channel, or when they cannot be
 * read. Reloads when topics change anywhere.
 */
export function useQuestionFolders(
  source: QuestionsSource,
  projectId: string
): readonly TopicFolder[] {
  const [folders, setFolders] = useState<{ key: string; list: readonly TopicFolder[] }>({
    key: '',
    list: []
  })
  const [revision, setRevision] = useState(0)
  useEffect(() => onTopicsChanged(() => setRevision((value) => value + 1)), [])
  const read = source['topics:folders']
  useEffect(() => {
    if (!read) return
    let live = true
    Promise.resolve()
      .then(() => read({ projectId }))
      .then(
        (list) => {
          if (live) setFolders({ key: projectId, list: list.folders })
        },
        () => {
          if (live) setFolders({ key: projectId, list: [] })
        }
      )
    return () => {
      live = false
    }
  }, [read, projectId, revision])
  return folders.key === projectId ? folders.list : []
}
