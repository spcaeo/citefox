/**
 * Renderer-only wizard types. The draft itself is the shared contract type
 * (`TopicDraft` in src/shared/domain/topics.ts), saved through `topics:*`.
 */
import type { TopicWizardStep } from '@shared/domain'

export interface WizardStepDef {
  id: TopicWizardStep
  label: string
}

/** A market the project checks, with its display label. */
export interface WizardMarket {
  id: string
  label: string
}

/** What the wizard needs from the open project. */
export interface WizardProject {
  id: string
  name: string
  domain: string
  markets: readonly WizardMarket[]
  /** Saved profile, for the chooser's examples (owner feedback 6). */
  brandNames?: readonly string[]
  competitors?: readonly string[]
  switchingFrom?: readonly string[]
}
