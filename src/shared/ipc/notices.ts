/** "Ask me" notices the main process records for the user to answer (FR-11.4, FR-11.7). */

import type { Notice } from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** Open notices, newest first. */
export interface NoticeList {
  notices: readonly Notice[]
}

export interface ResolveNoticeRequest {
  noticeId: string
  /** One of the notice's `actions[].id`. */
  actionId: string
}

export interface ResolveNoticeResult {
  notice: Notice
  /** What CiteFox did, in plain words. */
  message: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const noticesChannels = {
  'notices:list': invoke<NoticeList>(),
  'notices:resolve': invokeWith<ResolveNoticeRequest, ResolveNoticeResult>()
} as const satisfies InvokeChannelSpecs

/** Sent whenever a notice is added or resolved, with the open list. */
export const noticesEvents = {
  'notices:changed': push<NoticeList>()
} as const satisfies PushChannelSpecs
