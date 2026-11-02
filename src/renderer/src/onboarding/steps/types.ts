import type { FillFromWebsiteResult, SetupDraft } from '@shared/ipc'
import type { SetupSectionClient } from '../sectionClient'

/**
 * Props every v2 step screen takes (`steps/*Step.tsx`). OnboardingApp owns the draft,
 * the step URL (`#/setup/<step>`) and what Continue does (saving the profile after
 * step 6, `onboarding:finishSetup` on step 8); a step owns its sections, the
 * section URL state (`?open=…&edit=…`) and when its Continue is enabled.
 */
export interface SetupStepProps {
  draft: SetupDraft
  /** Functional update, so two quick changes never drop one. */
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
  sections: SetupSectionClient
  onBack: () => void
  onContinue: () => void
  /** True while Continue's own work runs (saving, finishing). */
  busy: boolean
  /** A visible message for this step (why Continue failed). Null for none. */
  alert: string | null
  /** Polite live-region announcement. */
  announce: (message: string) => void
  /** Footer line beside Continue, such as step 8's "First check: 10 questions × 2 answers · 140 credits". */
  footNote?: string | null
  /** Reads the site again, as step 3 did (step 4's Start over this step). */
  rereadSite?: () => Promise<FillFromWebsiteResult>
}
