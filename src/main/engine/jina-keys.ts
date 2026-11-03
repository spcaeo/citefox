import type { JinaKeyRef, JinaReadHooks } from '../pipeline/page-reader'
import { recordActivity } from '../storage/activity-events'
import type { AppStorage } from '../storage/app-storage'
import { insertConnectionEvent, listApiKeysByProvider } from '../storage/records'
import type { EngineHost } from './host'

/** FR-11.5. Jina keys that are on, in rotation order. Never the secrets. */
export function jinaKeysInOrder(storage: AppStorage): JinaKeyRef[] {
  return listApiKeysByProvider(storage.db, 'jina')
    .filter((key) => key.on && key.state !== 'off')
    .sort((a, b) => a.rotationOrder - b.rotationOrder)
    .map((key) => ({ id: key.id, name: key.name, keychainRef: key.keychainRef }))
}

/**
 * Records each Jina read for Connections' last 24 hours, and each failover as a
 * connection event on the refused key plus a plain-words notice (FR-11.10).
 */
export function jinaHooks(host: EngineHost, projectId: string | null): JinaReadHooks {
  const safely = (write: () => void): void => {
    try {
      write()
    } catch (error) {
      host.logger.warn('could not record Jina activity', {
        message: error instanceof Error ? error.message : 'write failed'
      })
    }
  }
  return {
    onRead: (keyId) =>
      safely(() =>
        recordActivity(host.storage.db, {
          id: host.createId(),
          at: host.now().toISOString(),
          kind: 'jina_read',
          keyId,
          projectId,
          count: 1,
          detail: null
        })
      ),
    onFailover: (from, to) =>
      safely(() => {
        const at = host.now().toISOString()
        const sentence =
          to === null
            ? `The page reader did not accept "${from.name}", so CiteFox read the page without a key at the lower rate limit.`
            : `The page reader did not accept "${from.name}", so CiteFox moved the read to "${to.name}".`
        insertConnectionEvent(host.storage.db, {
          id: host.createId(),
          keyId: from.id,
          at,
          kind: 'failover',
          detail: sentence
        })
        recordActivity(host.storage.db, {
          id: host.createId(),
          at,
          kind: 'jina_failover',
          keyId: from.id,
          projectId,
          count: 1,
          detail: sentence
        })
      })
  }
}
