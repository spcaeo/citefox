import type { SetupItem } from '@shared/ipc'

/** The mark in front of text CiteFox AI wrote (the same ✦ the AI-found rows carry). */
export const FILL_MARK = '✦'

/** What a row's detail line says when it has something: the detail, or "Added by you". */
export function manualDetailText(item: SetupItem): string {
  return item.detail || (item.origin === 'user' && !item.edited ? 'Added by you' : '')
}

/** True when a row has a detail line to show (its detail, or "Added by you"). */
export function hasManualDetail(item: SetupItem): boolean {
  return manualDetailText(item).length > 0
}
