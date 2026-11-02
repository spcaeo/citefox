import { useState } from 'react'
import { copyText } from '../../components/clipboard'
import type { HeaderPrimary } from '../../components/Header'
import { signalGuide } from '../../guide/signals'

export type CopyState = 'idle' | 'copied' | 'failed'

/** The fix brief's copy state and whether it is shown, shared by the button and the panel. */
export interface FixBriefState {
  copy: CopyState
  open: boolean
  onCopy: () => void
  onToggle: () => void
}

/** Copy state for the fix brief of one prompt (FR-13.6). */
export function useFixBrief(brief: string): FixBriefState {
  const [copy, setCopy] = useState<CopyState>('idle')
  const [open, setOpen] = useState(false)
  return {
    copy,
    open,
    onCopy: () => {
      void copyText(brief).then((ok) => {
        setCopy(ok ? 'copied' : 'failed')
        if (ok) signalGuide('fix-brief-copied')
      })
    },
    onToggle: () => setOpen((current) => !current)
  }
}

/** Copy fix brief as the prompt header's one green button. */
export function fixBriefPrimary(state: FixBriefState): HeaderPrimary {
  return {
    label: state.copy === 'copied' ? 'Copied' : 'Copy fix brief',
    icon: 'copy',
    onClick: state.onCopy,
    guide: 'prompt-fix-brief'
  }
}
