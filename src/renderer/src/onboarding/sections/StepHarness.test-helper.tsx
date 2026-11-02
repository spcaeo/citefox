import { useState, type JSX } from 'react'
import type { SetupDraft } from '@shared/ipc'
import type { SetupSectionClient } from '../sectionClient'
import type { SetupStepProps } from '../steps/types'

/** Renders a step with its draft in state, like OnboardingApp does. */
export function StepHarness({
  Step,
  initial,
  client,
  onContinue = () => undefined,
  onDraftSeen,
  footNote,
  busy = false
}: {
  Step: (props: SetupStepProps) => JSX.Element
  initial: SetupDraft
  client: SetupSectionClient
  onContinue?: () => void
  onDraftSeen?: (draft: SetupDraft) => void
  footNote?: string | null
  busy?: boolean
}): JSX.Element {
  const [draft, setDraft] = useState(initial)
  onDraftSeen?.(draft)
  return (
    <Step
      draft={draft}
      onDraft={setDraft}
      sections={client}
      onBack={() => undefined}
      onContinue={onContinue}
      busy={busy}
      alert={null}
      announce={() => undefined}
      footNote={footNote ?? null}
    />
  )
}
