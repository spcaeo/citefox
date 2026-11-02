import type { PageSetupDeps } from '../pipeline/setup'
import type { SqliteDatabase } from '../storage/database'
import { projectClaudeModel, resolveClaude } from './claude'
import type { EngineHost } from './host'
import { jinaHooks, jinaKeysInOrder } from './jina-keys'

/** The E4 page-setup dependencies for one IPC call. Secrets stay on the host. */
export function pageSetupDeps(
  host: EngineHost,
  projectDb: SqliteDatabase,
  projectId: string,
  channel: string
): PageSetupDeps {
  const settings = host.settings()
  return {
    appDb: host.storage.db,
    projectDb,
    transport: host.http,
    provider: resolveClaude(host, channel, projectId),
    logger: host.logger,
    secretStore: host.secrets,
    jinaKeychainRef: null,
    jinaKeys: jinaKeysInOrder(host.storage),
    jinaHooks: jinaHooks(host, projectId),
    jinaMode: settings.jinaMode,
    ...(host.pageDns !== undefined ? { dns: host.pageDns } : {}),
    projectId,
    secrets: host.knownSecrets(),
    now: () => host.now().toISOString(),
    model: projectClaudeModel(host, projectId)
  }
}
