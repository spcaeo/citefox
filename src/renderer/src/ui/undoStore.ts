/**
 * The one window-wide "Removed 3 questions · Undo" toast (deep audit §4.5:
 * every remove, move and bulk edit acts at once and offers Undo). Any screen
 * or drawer calls `showUndo`; `UndoToastHost` (mounted once by the shell)
 * draws the latest one. A newer toast replaces the older one, and the older
 * one's Undo is gone with it, the way a mail app's undo works.
 */
import { useSyncExternalStore } from 'react'

/** How long a toast stays before it hides (ms). */
export const UNDO_TOAST_MS = 10_000

export interface UndoToastSpec {
  /** What happened, past tense: "Removed 3 questions." */
  message: string
  /** A second, quieter line: what else changed ("Past results stay in History."). */
  effect?: string | null
  /**
   * Puts things back. Absent: the toast only reports. A rejected promise
   * shows its message in the toast instead of closing it.
   */
  undo?: () => Promise<unknown> | void
  /** "Undo" by default. */
  undoLabel?: string
  /** Shown after Undo works. Default "Undone." */
  undoneMessage?: string
  /** Test hook. */
  testId?: string
}

export interface UndoToastState {
  /** Bumps on every new toast so the host restarts its timer. */
  id: number
  spec: UndoToastSpec
  phase: 'shown' | 'undoing' | 'undone' | 'failed'
  error: string | null
}

let current: UndoToastState | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): UndoToastState | null {
  return current
}

/** Shows a toast (replacing the one showing). Returns its id. */
export function showUndo(spec: UndoToastSpec): number {
  const id = nextId
  nextId += 1
  current = { id, spec, phase: 'shown', error: null }
  emit()
  return id
}

/** Hides the toast `id` (default: whatever shows). */
export function hideUndo(id?: number): void {
  if (current === null) return
  if (id !== undefined && current.id !== id) return
  current = null
  emit()
}

/** Runs the showing toast's undo. */
export async function runUndo(id: number): Promise<void> {
  const shown = current
  if (shown === null || shown.id !== id || !shown.spec.undo) return
  if (shown.phase === 'undoing' || shown.phase === 'undone') return
  current = { ...shown, phase: 'undoing', error: null }
  emit()
  try {
    await shown.spec.undo()
    if (current?.id !== id) return
    current = { ...current, phase: 'undone' }
  } catch (cause) {
    if (current?.id !== id) return
    const message = cause instanceof Error && cause.message ? cause.message : 'Could not undo.'
    current = { ...current, phase: 'failed', error: message }
  }
  emit()
}

export function useUndoToast(): UndoToastState | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Tests only. */
export function resetUndoToastForTests(): void {
  current = null
  nextId = 1
  emit()
}
