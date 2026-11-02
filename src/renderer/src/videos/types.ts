import type { JSX } from 'react'
import type { VideoIdea, VideoScreen } from '@shared/domain'

/** The answers behind one number. `keys.length` is the number clicked (NFR-14). */
export interface AioDrill {
  id: string
  title: string
  description: string
  keys: readonly string[]
}

/** What an AI-assist slot sees (FR-18.10 hook point; another engineer fills it). */
export interface VideoAssistContext {
  projectId: string
  screen: VideoScreen
  selected: VideoIdea | null
}

export type VideoAssistSlot = (context: VideoAssistContext) => JSX.Element | null

/** Busy and result text for one action, shown next to its button. */
export interface ActionState {
  busy: boolean
  message: string | null
  error: boolean
}

export const IDLE: ActionState = { busy: false, message: null, error: false }
