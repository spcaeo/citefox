import type { JSX } from 'react'
import type { ApiKeyMetadata, ConnectionActivityLog } from '@shared/domain'
import { DrillNumber } from '../../drill'
import { isKeyWarningReason, warningCopy, WORKING_KEY_NOTE } from '../../keys/health'
import type { KeyActions } from '../hooks/useKeyActions'
import { keyEventsDrill } from '../utils/drills'
import { statusTone, statusWords } from '../utils/model'
import { Button } from '../../ui'

/** Plain words for the key's last stored failure, or null. */
function lastProblem(key: ApiKeyMetadata): string | null {
  if (key.lastReason && isKeyWarningReason(key.lastReason)) {
    return warningCopy(key.provider, key.lastReason)
  }
  return key.state === 'warning' ? (key.statusDetail ?? null) : null
}

/**
 * The detail behind a key's Status badge: the status in words, the last
 * failure and what to do, the key's recent events, and Test again.
 */
export function KeyStatusPanel({
  keyMeta,
  actions,
  log
}: {
  keyMeta: ApiKeyMetadata
  actions: KeyActions
  log: ConnectionActivityLog | null
}): JSX.Element {
  const problem = lastProblem(keyMeta)
  const drill = log ? keyEventsDrill(keyMeta, log) : null
  const count = drill?.items.length ?? 0
  return (
    <div className="conn-key-status" role="group" aria-label={`${keyMeta.name} status`}>
      <p>
        <span className="faint">Status: </span>
        <span className={`st st-${statusTone(keyMeta)}`}>{statusWords(keyMeta)}</span>
      </p>
      {problem ? (
        <p>
          <span className="faint">Last problem: </span>
          {problem}
        </p>
      ) : null}
      {keyMeta.lastReason === 'out_of_searches' ? <p className="hint">{WORKING_KEY_NOTE}</p> : null}
      {keyMeta.state === 'unchecked' ? (
        <p className="hint">Not tested yet. Test it to read its plan and see if it works.</p>
      ) : null}
      <p>
        {drill && count > 0 ? (
          <>
            <DrillNumber
              drill={drill}
              label={`${count} ${count === 1 ? 'event' : 'events'} on ${keyMeta.name} in the last 30 days`}
            />{' '}
            {count === 1 ? 'event' : 'events'} in the last 30 days
          </>
        ) : (
          <span className="faint">No limits, failures or failovers in the last 30 days.</span>
        )}
      </p>
      <Button size="sm" disabled={actions.busy} onClick={() => void actions.test(keyMeta)}>
        Test again
      </Button>
    </div>
  )
}
