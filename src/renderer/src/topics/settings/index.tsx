import { useMemo, type JSX } from 'react'
import { createEnginesSettingsSource } from '../../projectSettings/track/source'
import { createClustersSource } from '../clusters/source'
import { TopicSettingsDrawer, type TopicSettingsSource } from './TopicSettingsDrawer'

export { TopicSettingsDrawer, type TopicSettingsSource } from './TopicSettingsDrawer'

/** The shell's Topic settings drawer on the live channels (DrawerHost). */
export function TopicSettingsHost({
  projectId,
  topicId,
  source: given,
  onClose,
  onDeleted,
  onDuplicated
}: {
  projectId: string
  topicId: string
  source?: TopicSettingsSource
  onClose: () => void
  onDeleted: (topicId: string) => void
  onDuplicated: (topicId: string) => void
}): JSX.Element {
  const source = useMemo(() => given ?? createClustersSource(), [given])
  // A test passing its own topics source leaves the engines out, as it has no bridge.
  const engines = useMemo(() => (given ? null : createEnginesSettingsSource()), [given])
  return (
    <TopicSettingsDrawer
      projectId={projectId}
      topicId={topicId}
      source={source}
      engines={engines}
      onClose={onClose}
      onDeleted={() => onDeleted(topicId)}
      onDuplicated={onDuplicated}
    />
  )
}
