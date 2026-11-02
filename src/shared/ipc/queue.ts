/** The check queue. */

import type { CheckDueResult, QueuePauseScope, QueueStatus } from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** `queue:pause`. `all` stays until `queue:resume`. `today` clears at the next local midnight (FR-24.6). */
export interface QueuePauseRequest {
  scope: QueuePauseScope
}

/** Invoke channels for this area. Each one is declared here only. */
export const queueChannels = {
  'queue:getStatus': invoke<QueueStatus>(),
  'queue:pause': invokeWith<QueuePauseRequest, QueueStatus>(),
  'queue:resume': invoke<QueueStatus>(),
  'queue:checkDue': invoke<CheckDueResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const queueEvents = {
  'queue:status': push<QueueStatus>()
} as const satisfies PushChannelSpecs
